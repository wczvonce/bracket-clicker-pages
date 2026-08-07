(function () {
  "use strict";

  var FORM_ENDPOINT = "https://formsubmit.co/ajax/povraznikovav@gmail.com";
  var REQUEST_ID_PATTERN = /^web-[0-9a-f]{32}$/;
  var BOOKING_ID_PATTERN = /^[0-9]{6,20}$/;
  var PROPERTY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
  var ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_TOKEN_LENGTH = 8192;
  var SUBMIT_TIMEOUT_MS = 25000;

  var PROPERTY_LABELS = Object.freeze({
    APT7: "Apartmán 7 · Milvar",
    APT14: "Apartmán 14 · Školská",
    KAMZIK26: "Apartmán Kamzík 26",
    KAMZIK64: "Apartmán Kamzík 64",
    PARTIZANSKA: "Slnečný byt · Partizánska"
  });

  function decodeBase64UrlUtf8(encoded) {
    var padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    padded += "=".repeat((4 - (padded.length % 4)) % 4);
    var binary = atob(padded);
    var bytes = Uint8Array.from(binary, function (character) {
      return character.charCodeAt(0);
    });
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    var escaped = Array.from(bytes, function (byte) {
      return "%" + byte.toString(16).padStart(2, "0");
    }).join("");
    return decodeURIComponent(escaped);
  }

  function cleanText(value, maximumLength) {
    if (typeof value !== "string") return "";
    var cleaned = value.trim().replace(/\s+/g, " ");
    return cleaned.length <= maximumLength ? cleaned : "";
  }

  function normalizeProperties(claims) {
    var raw = Array.isArray(claims.props)
      ? claims.props
      : (claims.prop || claims.property_code ? [claims.prop || claims.property_code] : []);
    if (raw.length < 1 || raw.length > 8) throw new Error("properties");

    var seen = Object.create(null);
    var properties = raw.map(function (entry) {
      var code;
      var label;
      if (typeof entry === "string") {
        code = entry.trim().toUpperCase();
        label = PROPERTY_LABELS[code] || code;
      } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        code = String(entry.code || "").trim().toUpperCase();
        label = cleanText(entry.label, 100) || PROPERTY_LABELS[code] || code;
      } else {
        throw new Error("property");
      }
      if (!PROPERTY_CODE_PATTERN.test(code) || seen[code]) throw new Error("property");
      seen[code] = true;
      return Object.freeze({ code: code, label: label });
    });
    return Object.freeze(properties);
  }

  function decodeClaims(token, nowSeconds) {
    // Toto dekódovanie slúži iba na zobrazenie formulára. Podpis a oprávnenie
    // musí vždy overiť server pred vytvorením faktúry.
    if (typeof token !== "string" || token.length < 20 || token.length > MAX_TOKEN_LENGTH) {
      throw new Error("token");
    }
    var segments = token.split(".");
    if (
      segments.length !== 2 ||
      !/^[A-Za-z0-9_-]+$/.test(segments[0]) ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(segments[1])
    ) {
      throw new Error("token");
    }

    var parsed = JSON.parse(decodeBase64UrlUtf8(segments[0]));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 2) {
      throw new Error("claims");
    }

    var requestId = String(parsed.rid || "").trim();
    var guestName = cleanText(parsed.name, 200);
    var expiration = Number(parsed.exp);
    var currentTime = Number.isFinite(nowSeconds) ? nowSeconds : Date.now() / 1000;
    if (
      !REQUEST_ID_PATTERN.test(requestId) ||
      !guestName ||
      !Number.isSafeInteger(expiration) ||
      expiration <= currentTime
    ) {
      throw new Error(expiration <= currentTime ? "expired" : "claims");
    }

    var suppliedBookingId = String(parsed.bid || "").trim();
    var bookingId = BOOKING_ID_PATTERN.test(suppliedBookingId) ? suppliedBookingId : "";
    return Object.freeze({
      version: 2,
      requestId: requestId,
      guestName: guestName,
      bookingId: bookingId,
      expiration: expiration,
      properties: normalizeProperties(parsed)
    });
  }

  function isIsoDate(value) {
    if (!ISO_DATE_PATTERN.test(value)) return false;
    var date = new Date(value + "T00:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function normalizeGross(value) {
    var cleaned = String(value || "").trim().replace(/\s+/g, "").replace(",", ".");
    if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(cleaned)) return "";
    var amount = Number(cleaned);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000) return "";
    return amount.toFixed(2);
  }

  function validateValues(values, claims) {
    if (!BOOKING_ID_PATTERN.test(values.bookingId)) {
      return "Doplňte platné Booking ID (6 až 20 číslic).";
    }
    var allowedProperty = claims.properties.some(function (property) {
      return property.code === values.propertyCode;
    });
    if (!allowedProperty) {
      return "Vyberte správny apartmán.";
    }
    if (!isIsoDate(values.checkIn) || !isIsoDate(values.checkOut)) {
      return "Doplňte dátum príchodu aj odchodu.";
    }
    if (values.checkOut <= values.checkIn) {
      return "Dátum odchodu musí byť po dátume príchodu.";
    }
    if (!values.totalGross) {
      return "Doplňte platnú celkovú cenu od 0,01 do 10 000 EUR.";
    }
    if (!values.emailVerified) {
      return "Pred odoslaním potvrďte správnosť údajov.";
    }
    return "";
  }

  function createPayload(token, claims, values) {
    return {
      _subject: "[FAKTURA-DOPLNENIE] " + claims.requestId,
      _template: "table",
      _captcha: "false",
      owner_form_version: "2",
      owner_form_token: token,
      request_id: claims.requestId,
      property_code: values.propertyCode,
      check_in: values.checkIn,
      check_out: values.checkOut,
      total_gross: values.totalGross,
      booking_id: values.bookingId,
      email_verified: "true",
      confirmed_guest_name: claims.guestName
    };
  }

  function formSubmitAccepted(responseData) {
    return Boolean(
      responseData &&
      (responseData.success === true || responseData.success === "true")
    );
  }

  function setHidden(element, hidden) {
    element.classList.toggle("hidden", hidden);
  }

  function scrubTokenFromUrl() {
    history.replaceState(null, document.title, location.pathname);
  }

  function initialize() {
    var loadingPanel = document.getElementById("loadingPanel");
    var invalidPanel = document.getElementById("invalidPanel");
    var invalidMessage = document.getElementById("invalidMessage");
    var formPanel = document.getElementById("formPanel");
    var successPanel = document.getElementById("successPanel");
    var form = document.getElementById("ownerForm");
    var propertyField = document.getElementById("propertyField");
    var propertySelect = document.getElementById("propertyCode");
    var singleProperty = document.getElementById("singleProperty");
    var singlePropertyLabel = document.getElementById("singlePropertyLabel");
    var bookingIdInput = document.getElementById("bookingId");
    var checkInInput = document.getElementById("checkIn");
    var checkOutInput = document.getElementById("checkOut");
    var totalGrossInput = document.getElementById("totalGross");
    var emailVerifiedInput = document.getElementById("emailVerified");
    var button = document.getElementById("submitButton");
    var formError = document.getElementById("formError");
    var status = document.getElementById("status");

    function showInvalid(message) {
      setHidden(loadingPanel, true);
      setHidden(formPanel, true);
      setHidden(successPanel, true);
      invalidMessage.textContent = message;
      setHidden(invalidPanel, false);
      invalidPanel.focus();
    }

    var parameters = new URLSearchParams(location.hash.slice(1));
    var token = parameters.get("token") || "";
    var claims;
    try {
      claims = decodeClaims(token);
    } catch (error) {
      showInvalid(
        error && error.message === "expired"
          ? "Tento odkaz už vypršal. Otvorte najnovší e-mail s odkazom."
          : "Tento odkaz je neplatný alebo neúplný."
      );
      return;
    }

    document.getElementById("guestName").textContent = claims.guestName;
    document.getElementById("bookingSummary").textContent = claims.bookingId || "Neuvedené";
    bookingIdInput.value = claims.bookingId;

    if (claims.properties.length === 1) {
      // Skryty required <select> by inak zablokoval nativne odoslanie formulara
      // este pred spustenim nasho submit handlera (najma v mobilnom Chrome).
      propertySelect.required = false;
      propertySelect.disabled = true;
      singleProperty.dataset.propertyCode = claims.properties[0].code;
      singlePropertyLabel.textContent = claims.properties[0].label;
      setHidden(singleProperty, false);
    } else {
      propertySelect.required = true;
      propertySelect.disabled = false;
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Vyberte apartmán";
      placeholder.disabled = true;
      placeholder.selected = true;
      propertySelect.appendChild(placeholder);
      claims.properties.forEach(function (property) {
        var option = document.createElement("option");
        option.value = property.code;
        option.textContent = property.label;
        propertySelect.appendChild(option);
      });
      setHidden(propertyField, false);
    }

    setHidden(loadingPanel, true);
    setHidden(invalidPanel, true);
    setHidden(formPanel, false);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (button.disabled) return;

      var values = {
        propertyCode: claims.properties.length === 1
          ? claims.properties[0].code
          : propertySelect.value,
        bookingId: bookingIdInput.value.trim(),
        checkIn: checkInInput.value,
        checkOut: checkOutInput.value,
        totalGross: normalizeGross(totalGrossInput.value),
        emailVerified: emailVerifiedInput.checked
      };
      var validationError = validateValues(values, claims);
      if (validationError) {
        formError.textContent = validationError;
        setHidden(formError, false);
        formError.focus();
        return;
      }

      setHidden(formError, true);
      button.disabled = true;
      button.textContent = "Odosielam…";
      status.textContent = "Údaje sa bezpečne odosielajú.";

      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timeout = controller
        ? setTimeout(function () { controller.abort(); }, SUBMIT_TIMEOUT_MS)
        : null;
      try {
        var options = {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          // FormSubmit odmieta poziadavky bez dokazatelneho weboveho povodu.
          // Pri cross-origin poziadavke sa posle iba origin; fragment s tokenom
          // sa podla weboveho standardu do Referer hlavicky nikdy nezahrna.
          referrerPolicy: "strict-origin-when-cross-origin",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(createPayload(token, claims, values))
        };
        if (controller) options.signal = controller.signal;
        var response = await fetch(FORM_ENDPOINT, options);
        var responseData = await response.json().catch(function () { return null; });
        if (!response.ok || !formSubmitAccepted(responseData)) throw new Error("submit");

        form.querySelectorAll("input, select, button").forEach(function (element) {
          element.disabled = true;
        });
        // Fragment sa neposiela serveru ani v Referer hlavičke. Ponecháme ho
        // do úspechu, aby formulár prežil obnovenie alebo ukončenie karty v mobile.
        scrubTokenFromUrl();
        setHidden(formPanel, true);
        setHidden(successPanel, false);
        successPanel.focus();
      } catch (error) {
        formError.textContent = "Odoslanie sa nemuselo dokončiť. Neodosielajte formulár hneď znova. Počkajte jednu minútu a skontrolujte e-mail; ak faktúra nepríde, skúste odoslanie znova alebo údaje doplňte odpoveďou na pôvodný e-mail.";
        setHidden(formError, false);
        formError.focus();
        button.disabled = false;
        button.textContent = "Vytvoriť a odoslať faktúru";
        status.textContent = "";
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    });
  }

  var testApi = Object.freeze({
    decodeClaims: decodeClaims,
    normalizeGross: normalizeGross,
    validateValues: validateValues,
    createPayload: createPayload,
    formSubmitAccepted: formSubmitAccepted,
    scrubTokenFromUrl: scrubTokenFromUrl,
    initialize: initialize
  });
  if (globalThis.__OWNER_INVOICE_TEST__) {
    globalThis.__OWNER_INVOICE_TEST_API__ = testApi;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
