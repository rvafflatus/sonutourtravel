var INVOICE_HEADERS = [
  "Invoice No", "Date", "Type", "Client Name", "Customer State", "Customer Address",
  "Service 1", "Description 1", "Tax Rate 1", "Amount 1",
  "Service 2", "Description 2", "Tax Rate 2", "Amount 2",
  "Service 3", "Description 3", "Tax Rate 3", "Amount 3",
  "Service 4", "Description 4", "Tax Rate 4", "Amount 4",
  "Total CGST", "Total SGST", "Total IGST", "Total Amount"
];

var HSN_HEADERS = ["Name", "HSN"];

var DEFAULT_HSN = [
  ["Domestic", "998552"],
  ["International", "998552"],
  ["Flight Booking", "998551"],
  ["Service Charges", "998552"],
  ["Hotel Bookings", "998552"],
  ["Cab bookings", "9964"]
];

var INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand",
  "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra",
  "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal"
];

var ALLOWED_TAX_RATES = [0, 5, 12, 18, 28];
var SESSION_TTL_SECONDS = 21600;

function doGet(event) {
  try {
    var action = event && event.parameter ? event.parameter.action : "";
    if (action !== "bootstrap") return jsonOutput_({ ok: false, error: "Unsupported GET action." });
    requireSession_(event.parameter.token);
    return jsonOutput_({
      ok: true,
      invoices: readInvoices_(),
      hsn: readHsn_()
    });
  } catch (error) {
    return jsonOutput_({ ok: false, error: safeError_(error) });
  }
}

function doPost(event) {
  try {
    var body = JSON.parse(event && event.postData ? event.postData.contents : "{}");
    var action = String(body.action || "");
    if (action === "login") return login_(body.password);
    if (action === "logout") return logout_(body.token);
    requireSession_(body.token);

    if (action === "saveInvoice") return saveInvoice_(body.invoice, "");
    if (action === "updateInvoice") return saveInvoice_(body.invoice, body.originalInvoiceNo);
    if (action === "deleteInvoice") return deleteInvoice_(body.invoiceNo);
    return jsonOutput_({ ok: false, error: "Unsupported POST action." });
  } catch (error) {
    return jsonOutput_({ ok: false, error: safeError_(error) });
  }
}

function login_(password) {
  var configuredPassword = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!configuredPassword) {
    return jsonOutput_({ ok: false, error: "Admin authentication is not configured in Apps Script Properties." });
  }
  if (!constantTimeEqual_(String(password == null ? "" : password), configuredPassword)) {
    return jsonOutput_({ ok: false, error: "Incorrect admin password." });
  }

  var token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  CacheService.getScriptCache().put("session:" + token, "active", SESSION_TTL_SECONDS);
  return jsonOutput_({ ok: true, token: token, expiresIn: SESSION_TTL_SECONDS });
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove("session:" + String(token));
  return jsonOutput_({ ok: true });
}

function requireSession_(token) {
  var key = String(token || "");
  if (!/^[a-f0-9]{64}$/i.test(key) || CacheService.getScriptCache().get("session:" + key) !== "active") {
    throw new Error("Session expired or unauthorized. Sign in again.");
  }
}

function constantTimeEqual_(left, right) {
  var leftHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, left, Utilities.Charset.UTF_8);
  var rightHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, right, Utilities.Charset.UTF_8);
  var difference = 0;
  for (var index = 0; index < leftHash.length; index += 1) {
    difference |= (leftHash[index] & 255) ^ (rightHash[index] & 255);
  }
  return difference === 0;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function safeError_(error) {
  var message = error && error.message ? String(error.message) : "The request could not be completed.";
  return message.slice(0, 240);
}

function getSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  var spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Set SPREADSHEET_ID in Apps Script Properties or bind this script to the target spreadsheet.");
  return spreadsheet;
}

function getSheetWithHeaders_(sheetName, headers) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (lastColumn !== headers.length ||
      headers.some(function (header, index) { return actual[index] !== header; })) {
    throw new Error("The " + sheetName + " tab must use the required header row in the exact column order.");
  }
  return sheet;
}

function getHsnSheet_() {
  var sheet = getSheetWithHeaders_("Sheet1", HSN_HEADERS);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, DEFAULT_HSN.length, HSN_HEADERS.length).setValues(DEFAULT_HSN);
  }
  return sheet;
}

function readHsn_() {
  var sheet = getHsnSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HSN_HEADERS.length).getDisplayValues()
    .filter(function (row) { return row[0] && row[1]; })
    .map(function (row) { return { Name: String(row[0]), HSN: String(row[1]) }; });
}

function getInvoicesSheet_() {
  return getSheetWithHeaders_("Invoices", INVOICE_HEADERS);
}

function dateToIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var text = String(value == null ? "" : value);
  var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return text;
}

function readInvoices_() {
  var sheet = getInvoicesSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, INVOICE_HEADERS.length).getValues()
    .filter(function (row) { return String(row[0] || "").trim() !== ""; })
    .map(function (row) {
      var invoice = {};
      INVOICE_HEADERS.forEach(function (header, index) {
        invoice[header] = header === "Date" ? dateToIso_(row[index]) : row[index];
      });
      return invoice;
    });
}

function roundMoney_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function safeText_(value, maxLength, label) {
  var text = String(value == null ? "" : value).trim();
  if (text.length > maxLength) throw new Error(label + " is too long.");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return text;
}

function validateDate_(value) {
  var date = String(value || "");
  var match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Enter a valid invoice date.");
  var parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1]) ||
      parsed.getUTCMonth() + 1 !== Number(match[2]) ||
      parsed.getUTCDate() !== Number(match[3])) {
    throw new Error("Enter a valid invoice date.");
  }
  return date;
}

function normalizeInvoice_(input) {
  if (!input || typeof input !== "object") throw new Error("Invoice details are missing.");
  var invoiceNo = safeText_(input["Invoice No"], 40, "Invoice number");
  if (!invoiceNo) throw new Error("Invoice number is required.");
  var date = validateDate_(input.Date);
  var type = String(input.Type || "");
  if (type !== "customer" && type !== "vendor/expense") throw new Error("Choose a valid invoice type.");
  var client = safeText_(input["Client Name"], 160, "Client name");
  if (!client) throw new Error("Client / vendor name is required.");
  var customerState = safeText_(input["Customer State"], 100, "Customer state");
  if (INDIAN_STATES.indexOf(customerState) === -1) throw new Error("Choose a valid Indian state or union territory.");
  var address = safeText_(input["Customer Address"], 1000, "Customer address");
  var lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length || lines.length > 4) throw new Error("An invoice must contain between one and four service lines.");

  var hsn = readHsn_();
  var serviceNames = hsn.map(function (item) { return item.Name; });
  var normalizedLines = [];
  var taxableTotal = 0;
  var cgstTotal = 0;
  var sgstTotal = 0;
  var igstTotal = 0;
  lines.forEach(function (line, index) {
    var service = safeText_(line.service, 120, "Service " + (index + 1));
    if (serviceNames.indexOf(service) === -1) throw new Error("Service " + (index + 1) + " is not in the HSN master.");
    var description = safeText_(line.description, 160, "Description " + (index + 1));
    var rate = Number(line.rate);
    if (ALLOWED_TAX_RATES.indexOf(rate) === -1) throw new Error("Select an allowed GST rate for service " + (index + 1) + ".");
    var amount = Number(line.amount);
    if (!isFinite(amount) || amount <= 0 || amount > 1000000000) throw new Error("Enter a taxable amount greater than zero for service " + (index + 1) + ".");
    amount = roundMoney_(amount);
    var lineTax = roundMoney_(amount * rate / 100);
    taxableTotal += amount;
    if (customerState === "Rajasthan") {
      var lineCgst = roundMoney_(lineTax / 2);
      cgstTotal += lineCgst;
      sgstTotal += roundMoney_(lineTax - lineCgst);
    } else {
      igstTotal += lineTax;
    }
    normalizedLines.push({
      service: service,
      description: description,
      rate: rate,
      amount: amount
    });
  });

  taxableTotal = roundMoney_(taxableTotal);
  cgstTotal = roundMoney_(cgstTotal);
  sgstTotal = roundMoney_(sgstTotal);
  igstTotal = roundMoney_(igstTotal);
  var total = roundMoney_(taxableTotal + cgstTotal + sgstTotal + igstTotal);
  var row = [
    invoiceNo, date, type, client, customerState, address,
    "", "", "", 0, "", "", "", 0, "", "", "", 0, "", "", "", 0,
    cgstTotal, sgstTotal, igstTotal, total
  ];
  normalizedLines.forEach(function (line, index) {
    var offset = 6 + index * 4;
    row[offset] = line.service;
    row[offset + 1] = line.description;
    row[offset + 2] = line.rate;
    row[offset + 3] = line.amount;
  });
  return { row: row, invoiceNo: invoiceNo, originalLines: normalizedLines };
}

function findInvoiceRow_(sheet, invoiceNo) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][0]).trim() === invoiceNo) return index + 2;
  }
  return -1;
}

function saveInvoice_(input, originalInvoiceNo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var normalized = normalizeInvoice_(input);
    var sheet = getInvoicesSheet_();
    var existingRow = originalInvoiceNo ? findInvoiceRow_(sheet, String(originalInvoiceNo)) : -1;
    if (originalInvoiceNo && existingRow === -1) throw new Error("The invoice being edited no longer exists.");
    var conflictingRow = findInvoiceRow_(sheet, normalized.invoiceNo);
    if (conflictingRow !== -1 && conflictingRow !== existingRow) throw new Error("That invoice number is already in use.");
    if (existingRow === -1) {
      sheet.appendRow(normalized.row);
    } else {
      sheet.getRange(existingRow, 1, 1, INVOICE_HEADERS.length).setValues([normalized.row]);
    }
    SpreadsheetApp.flush();
    return jsonOutput_({ ok: true, invoiceNo: normalized.invoiceNo });
  } finally {
    lock.releaseLock();
  }
}

function deleteInvoice_(invoiceNo) {
  var key = safeText_(invoiceNo, 40, "Invoice number");
  if (!key) throw new Error("Invoice number is required.");
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getInvoicesSheet_();
    var row = findInvoiceRow_(sheet, key);
    if (row === -1) throw new Error("Invoice not found.");
    sheet.deleteRow(row);
    SpreadsheetApp.flush();
    return jsonOutput_({ ok: true, invoiceNo: key });
  } finally {
    lock.releaseLock();
  }
}
