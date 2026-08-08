(function () {
  "use strict";

  var READY_FLAG = "__AP14_INVOICE_IDEMPOTENCY_READY__";
  globalThis[READY_FLAG] = false;

  var SOURCE_SITE = "apartman14.github.io";
  var LEGACY_STORAGE_KEY = "booking-invoice-pending-v1:" + SOURCE_SITE;
  var STORAGE_KEY_PREFIX = LEGACY_STORAGE_KEY + ":";
  var LOCK_NAME_PREFIX = "booking-invoice-request-v1:" + SOURCE_SITE + ":";
  var PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  var REQUEST_ID_PATTERN = /^web-[0-9a-f]{32}$/;
  var FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

  function pendingStorageKey(fingerprint) {
    if (!FINGERPRINT_PATTERN.test(String(fingerprint || ""))) throw new Error("invalid-fingerprint");
    return STORAGE_KEY_PREFIX + fingerprint;
  }

  function lockNameForFingerprint(fingerprint) {
    if (!FINGERPRINT_PATTERN.test(String(fingerprint || ""))) throw new Error("invalid-fingerprint");
    return LOCK_NAME_PREFIX + fingerprint;
  }

  function requiredLocalStorage() {
    try {
      var store = globalThis.localStorage;
      if (
        store &&
        typeof store.getItem === "function" &&
        typeof store.setItem === "function" &&
        typeof store.removeItem === "function"
      ) {
        return store;
      }
    } catch (error) {}
    throw new Error("pending-storage-unavailable");
  }

  function requiredLockManager() {
    try {
      var locks = globalThis.navigator && globalThis.navigator.locks;
      if (locks && typeof locks.request === "function") return locks;
    } catch (error) {}
    throw new Error("web-locks-unavailable");
  }

  function withFingerprintLock(fingerprint, callback) {
    return requiredLockManager().request(
      lockNameForFingerprint(fingerprint),
      { mode: "exclusive" },
      callback
    );
  }

  function normalizePending(value, now) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) return null;
    var requestId = String(value.requestId || "");
    var fingerprint = String(value.fingerprint || "");
    var expiresAt = Number(value.expiresAt);
    var state = value.state === "acknowledged" ? "acknowledged" : "pending";
    if (
      !REQUEST_ID_PATTERN.test(requestId) ||
      !FINGERPRINT_PATTERN.test(fingerprint) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + PENDING_TTL_MS
    ) {
      return null;
    }
    return {
      version: 1,
      requestId: requestId,
      fingerprint: fingerprint,
      expiresAt: expiresAt,
      state: state
    };
  }

  function removeKeyConfirmed(key) {
    var store = requiredLocalStorage();
    try {
      store.removeItem(key);
      if (store.getItem(key) !== null) throw new Error("pending-storage-remove-unconfirmed");
    } catch (error) {
      throw new Error("pending-storage-unavailable");
    }
  }

  function readRecord(key, now, removeInvalid) {
    var store = requiredLocalStorage();
    var raw = "";
    try {
      raw = store.getItem(key) || "";
    } catch (error) {
      throw new Error("pending-storage-unavailable");
    }
    if (!raw) return null;

    var parsed = null;
    try {
      parsed = normalizePending(JSON.parse(raw), now);
    } catch (error) {}
    if (!parsed) {
      if (removeInvalid !== false) removeKeyConfirmed(key);
      return null;
    }
    return parsed;
  }

  function writePending(record) {
    var store = requiredLocalStorage();
    var key = pendingStorageKey(record.fingerprint);
    var encoded = JSON.stringify(record);
    try {
      store.setItem(key, encoded);
      if (store.getItem(key) !== encoded) throw new Error("pending-storage-unconfirmed");
    } catch (error) {
      throw new Error("pending-storage-unavailable");
    }
  }

  function readPending(fingerprint, now) {
    var exactKey = pendingStorageKey(fingerprint);
    var exact = readRecord(exactKey, now);
    if (exact && exact.fingerprint !== fingerprint) {
      removeKeyConfirmed(exactKey);
      exact = null;
    }

    if (exact) return exact;

    var legacy = readRecord(LEGACY_STORAGE_KEY, now, false);
    if (!legacy || legacy.fingerprint !== fingerprint) return null;

    writePending(legacy);
    return legacy;
  }

  function canonicalPayload(payload) {
    return JSON.stringify(
      Object.keys(payload)
        .filter(function (key) { return key !== "request_id" && key !== "ack_nonce"; })
        .sort()
        .map(function (key) { return [key, String(payload[key] == null ? "" : payload[key])]; })
    );
  }

  async function createFingerprint(payload) {
    if (
      !globalThis.crypto ||
      !crypto.subtle ||
      typeof crypto.subtle.digest !== "function" ||
      typeof TextEncoder !== "function"
    ) {
      throw new Error("fingerprint-unavailable");
    }
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload(payload)));
    return Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function payloadFromForm() {
    var guestEmail = document.getElementById("invoiceEmail").value.trim().toLowerCase();
    return {
      action: "guest_request",
      schema_version: "4",
      request_id: "",
      property_code: "APT14",
      source_site: SOURCE_SITE,
      guest_name: document.getElementById("invoiceName").value.trim(),
      street: document.getElementById("invoiceStreet").value.trim(),
      postal_code: document.getElementById("invoicePostalCode").value.trim(),
      city: document.getElementById("invoiceCity").value.trim(),
      country: document.getElementById("invoiceCountry").value.trim(),
      company_id: document.getElementById("invoiceCompanyId").value.trim(),
      tax_id: document.getElementById("invoiceTaxId").value.trim(),
      vat_id: document.getElementById("invoiceVatId").value.trim(),
      guest_email: guestEmail,
      booking_id: document.getElementById("invoiceBookingId").value.replace(/\D/g, ""),
      note: document.getElementById("invoiceNote").value.trim(),
      email_confirmed: String(document.getElementById("invoiceEmailConfirmedCheck").checked),
      electronic_delivery_consent: String(document.getElementById("invoiceConsent").checked),
      _honey: document.getElementById("invoiceHoney").value
    };
  }

  async function getOrCreateRequestId(fingerprint, now) {
    if (!FINGERPRINT_PATTERN.test(String(fingerprint || ""))) throw new Error("invalid-fingerprint");
    return await withFingerprintLock(fingerprint, function () {
      var currentTime = Number.isFinite(now) ? now : Date.now();
      var field = document.getElementById("invoiceRequestId");
      var pending = readPending(fingerprint, currentTime);
      if (pending) {
        field.value = pending.requestId;
        return pending.requestId;
      }
      if (typeof globalThis.createInvoiceRequestId !== "function") throw new Error("request-id-unavailable");
      var requestId = globalThis.createInvoiceRequestId();
      writePending({
        version: 1,
        requestId: requestId,
        fingerprint: fingerprint,
        expiresAt: currentTime + PENDING_TTL_MS,
        state: "pending"
      });
      field.value = requestId;
      return requestId;
    });
  }

  async function clearMatchingRequest(requestId, fingerprint, now) {
    var field = document.getElementById("invoiceRequestId");
    if (
      !REQUEST_ID_PATTERN.test(String(requestId || "")) ||
      !FINGERPRINT_PATTERN.test(String(fingerprint || ""))
    ) {
      return false;
    }

    return await withFingerprintLock(fingerprint, function () {
      var currentTime = Number.isFinite(now) ? now : Date.now();
      var key = pendingStorageKey(fingerprint);
      var pending = readRecord(key, currentTime);
      if (!pending) {
        if (field.value === requestId) field.value = "";
        return true;
      }
      if (
        pending.requestId !== requestId ||
        pending.fingerprint !== fingerprint
      ) {
        if (field.value === requestId) field.value = "";
        return false;
      }
      writePending({
        version: 1,
        requestId: pending.requestId,
        fingerprint: pending.fingerprint,
        expiresAt: pending.expiresAt,
        state: "acknowledged"
      });
      if (field.value === requestId) field.value = "";
      return true;
    });
  }

  if (globalThis.__AP14_INVOICE_IDEMPOTENCY_TEST__) {
    globalThis.__AP14_INVOICE_IDEMPOTENCY_TEST_API__ = Object.freeze({
      createFingerprint: createFingerprint,
      getOrCreateRequestId: getOrCreateRequestId,
      clearMatchingRequest: clearMatchingRequest,
      payloadFromForm: payloadFromForm,
      legacyStorageKey: LEGACY_STORAGE_KEY,
      storageKeyForFingerprint: pendingStorageKey,
      lockNameForFingerprint: lockNameForFingerprint
    });
  }

  var form = document.getElementById("form");
  if (
    !form ||
    typeof form.onsubmit !== "function" ||
    globalThis.__AP14_INVOICE_BASE_HANDLER_READY__ !== true
  ) {
    return;
  }
  var originalSubmit = form.onsubmit;
  var originalClear = globalThis.clearInvoiceRequestId;
  var activeRequestId = "";
  var activeFingerprint = "";
  var activeClearPromise = null;
  var preparing = false;

  globalThis.clearInvoiceRequestId = function () {
    var requestId = activeRequestId;
    var fingerprint = activeFingerprint;
    activeRequestId = "";
    activeFingerprint = "";
    activeClearPromise =
      requestId && fingerprint
        ? clearMatchingRequest(requestId, fingerprint)
            .then(function (cleared) {
              if (cleared && typeof originalClear === "function") originalClear();
              return cleared;
            })
            .catch(function (error) {
              document.getElementById("invoiceRequestId").value = requestId;
              throw error;
            })
        : Promise.resolve(false);
    return activeClearPromise;
  };

  async function wrappedSubmit(event) {
    event.preventDefault();
    if (preparing) return false;
    var guestEmail = document.getElementById("invoiceEmail").value.trim().toLowerCase();
    var confirmedEmail = document.getElementById("invoiceEmailConfirm").value.trim().toLowerCase();
    var confirmationsValid =
      document.getElementById("invoiceEmailConfirmedCheck").checked &&
      document.getElementById("invoiceConsent").checked;
    if (guestEmail !== confirmedEmail || !confirmationsValid) return originalSubmit.call(this, event);

    preparing = true;
    try {
      var payload = payloadFromForm();
      var payloadSnapshot = canonicalPayload(payload);
      activeFingerprint = await createFingerprint(payload);
      activeRequestId = await getOrCreateRequestId(activeFingerprint);
      if (canonicalPayload(payloadFromForm()) !== payloadSnapshot) {
        var requestField = document.getElementById("invoiceRequestId");
        if (requestField.value === activeRequestId) requestField.value = "";
        activeRequestId = "";
        activeFingerprint = "";
        document.getElementById("status").textContent =
          "Údaje sa počas prípravy odoslania zmenili. Skontrolujte ich a odošlite formulár znova.";
        return false;
      }
      var result = await originalSubmit.call(this, event);
      if (activeClearPromise) {
        var clearPromise = activeClearPromise;
        activeClearPromise = null;
        try {
          await clearPromise;
        } catch (clearError) {
          document.getElementById("status").textContent =
            "Údaje boli prijaté, ale bezpečný kód sa nepodarilo vyčistiť. Formulár neposielajte znova.";
        }
      }
      return result;
    } catch (error) {
      document.getElementById("status").textContent =
        "Bezpečné opakované odoslanie nie je v tomto prehliadači dostupné. Skúste novší prehliadač.";
      return false;
    } finally {
      preparing = false;
    }
  }

  form.onsubmit = wrappedSubmit;
  if (form.onsubmit !== wrappedSubmit) return;
  globalThis[READY_FLAG] = true;
})();
