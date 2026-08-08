(function () {
  "use strict";

  var SOURCE_SITE = "apartman14.github.io";
  var STORAGE_KEY = "booking-invoice-pending-v1:" + SOURCE_SITE;
  var PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  var REQUEST_ID_PATTERN = /^web-[0-9a-f]{32}$/;
  var FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
  var pendingMemory = null;

  function storageCandidates() {
    var stores = [];
    ["localStorage", "sessionStorage"].forEach(function (name) {
      try {
        var store = globalThis[name];
        if (
          store &&
          typeof store.getItem === "function" &&
          typeof store.setItem === "function" &&
          typeof store.removeItem === "function"
        ) {
          stores.push(store);
        }
      } catch (error) {}
    });
    return stores;
  }

  function normalizePending(value, now) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) return null;
    var requestId = String(value.requestId || "");
    var fingerprint = String(value.fingerprint || "");
    var expiresAt = Number(value.expiresAt);
    if (
      !REQUEST_ID_PATTERN.test(requestId) ||
      !FINGERPRINT_PATTERN.test(fingerprint) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + PENDING_TTL_MS
    ) {
      return null;
    }
    return { version: 1, requestId: requestId, fingerprint: fingerprint, expiresAt: expiresAt };
  }

  function readPending(now) {
    var currentTime = Number.isFinite(now) ? now : Date.now();
    var memory = normalizePending(pendingMemory, currentTime);
    if (memory) return memory;
    pendingMemory = null;
    var stores = storageCandidates();
    for (var index = 0; index < stores.length; index += 1) {
      var raw = "";
      try {
        raw = stores[index].getItem(STORAGE_KEY) || "";
      } catch (error) {
        continue;
      }
      if (!raw) continue;
      var parsed = null;
      try {
        parsed = normalizePending(JSON.parse(raw), currentTime);
      } catch (error) {}
      if (!parsed) {
        try { stores[index].removeItem(STORAGE_KEY); } catch (error) {}
        continue;
      }
      pendingMemory = parsed;
      return parsed;
    }
    return null;
  }

  function writePending(record) {
    var stores = storageCandidates();
    var encoded = JSON.stringify(record);
    for (var index = 0; index < stores.length; index += 1) {
      try {
        stores[index].setItem(STORAGE_KEY, encoded);
        if (stores[index].getItem(STORAGE_KEY) !== encoded) throw new Error("pending-storage-unconfirmed");
        pendingMemory = record;
        for (var fallback = index + 1; fallback < stores.length; fallback += 1) {
          try { stores[fallback].removeItem(STORAGE_KEY); } catch (error) {}
        }
        return;
      } catch (error) {}
    }
    throw new Error("pending-storage-unavailable");
  }

  function removePending() {
    pendingMemory = null;
    storageCandidates().forEach(function (store) {
      try { store.removeItem(STORAGE_KEY); } catch (error) {}
    });
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

  function getOrCreateRequestId(fingerprint, now) {
    var currentTime = Number.isFinite(now) ? now : Date.now();
    if (!FINGERPRINT_PATTERN.test(String(fingerprint || ""))) throw new Error("invalid-fingerprint");
    var field = document.getElementById("invoiceRequestId");
    var pending = readPending(currentTime);
    if (pending && pending.fingerprint === fingerprint) {
      field.value = pending.requestId;
      return pending.requestId;
    }
    if (typeof globalThis.createInvoiceRequestId !== "function") throw new Error("request-id-unavailable");
    var requestId = globalThis.createInvoiceRequestId();
    writePending({
      version: 1,
      requestId: requestId,
      fingerprint: fingerprint,
      expiresAt: currentTime + PENDING_TTL_MS
    });
    field.value = requestId;
    return requestId;
  }

  function clearMatchingRequest(requestId, fingerprint, now) {
    var currentTime = Number.isFinite(now) ? now : Date.now();
    var field = document.getElementById("invoiceRequestId");
    if (!field.value || field.value === requestId) field.value = "";
    var pending = readPending(currentTime);
    if (pending && pending.requestId === requestId && pending.fingerprint === fingerprint) removePending();
  }

  if (globalThis.__AP14_INVOICE_IDEMPOTENCY_TEST__) {
    globalThis.__AP14_INVOICE_IDEMPOTENCY_TEST_API__ = Object.freeze({
      createFingerprint: createFingerprint,
      getOrCreateRequestId: getOrCreateRequestId,
      clearMatchingRequest: clearMatchingRequest,
      readPending: readPending,
      payloadFromForm: payloadFromForm,
      storageKey: STORAGE_KEY
    });
  }

  var form = document.getElementById("form");
  if (!form || typeof form.onsubmit !== "function") return;
  var originalSubmit = form.onsubmit;
  var originalClear = globalThis.clearInvoiceRequestId;
  var activeRequestId = "";
  var activeFingerprint = "";
  var preparing = false;

  globalThis.clearInvoiceRequestId = function () {
    if (activeRequestId && activeFingerprint) clearMatchingRequest(activeRequestId, activeFingerprint);
    if (typeof originalClear === "function") originalClear();
    activeRequestId = "";
    activeFingerprint = "";
  };

  form.onsubmit = async function (event) {
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
      activeFingerprint = await createFingerprint(payload);
      activeRequestId = getOrCreateRequestId(activeFingerprint);
      return await originalSubmit.call(this, event);
    } catch (error) {
      document.getElementById("status").textContent =
        "Bezpečné opakované odoslanie nie je v tomto prehliadači dostupné. Skúste novší prehliadač.";
      return false;
    } finally {
      preparing = false;
    }
  };
})();
