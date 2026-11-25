(function () {
  "use strict";

  var API_URL = window.SONUTOUR_ADMIN_CONFIG && window.SONUTOUR_ADMIN_CONFIG.apiUrl;
  var SESSION_KEY = "sonuTourAdminSession";
  var INVOICE_HEADERS = [
    "Invoice No", "Date", "Type", "Client Name", "Customer State", "Customer Address",
    "Service 1", "Description 1", "Tax Rate 1", "Amount 1",
    "Service 2", "Description 2", "Tax Rate 2", "Amount 2",
    "Service 3", "Description 3", "Tax Rate 3", "Amount 3",
    "Service 4", "Description 4", "Tax Rate 4", "Amount 4",
    "Total CGST", "Total SGST", "Total IGST", "Total Amount"
  ];
  var DEFAULT_HSN = [
    { Name: "Domestic", HSN: "998552" },
    { Name: "International", HSN: "998552" },
    { Name: "Flight Booking", HSN: "998551" },
    { Name: "Service Charges", HSN: "998552" },
    { Name: "Hotel Bookings", HSN: "998552" },
    { Name: "Cab bookings", HSN: "9964" }
  ];
  var STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
    "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand",
    "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra",
    "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
    "Uttarakhand", "West Bengal"
  ];
  var RATES = [0, 5, 12, 18, 28];
  var state = {
    token: "",
    invoices: [],
    hsn: DEFAULT_HSN.slice(),
    editing: false,
    renderedLines: 0,
    toastTimer: 0,
    analyticsRange: { from: "", to: "", label: "All time" },
    analyticsCharts: {}
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function formatMoney(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) amount = 0;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function localDateValue() {
    var now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  }

  function displayDate(value) {
    if (!value) return "—";
    var date = new Date(String(value).slice(0, 10) + "T00:00:00");
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function setSyncStatus(kind, label) {
    var status = byId("sync-status");
    status.className = "sync-status" + (kind ? " is-" + kind : "");
    status.querySelector("span").textContent = label;
  }

  function setButtonLoading(button, isLoading) {
    button.classList.toggle("is-loading", isLoading);
    button.disabled = isLoading;
  }

  function showToast(message, isError) {
    var region = byId("toast-region");
    region.textContent = "";
    var toast = document.createElement("div");
    toast.className = "toast" + (isError ? " error" : "");
    toast.textContent = message;
    region.appendChild(toast);
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(function () {
      toast.remove();
    }, 4200);
  }

  function setLoginError(message) {
    var error = byId("login-error");
    error.textContent = message;
    error.hidden = !message;
  }

  function apiErrorMessage(error) {
    if (error instanceof TypeError) {
      return "Could not reach the Apps Script Web App. Check that the deployed web app is accessible and its URL is correct.";
    }
    return error && error.message ? error.message : "The request could not be completed.";
  }

  function isSuccessfulTextResponse(text) {
    return /^(?:ok|success(?:fully)?|(?:saved|added|updated|deleted)(?: successfully)?|(?:invoice|service|hsn)\b.{0,120}\b(?:saved|added|updated|deleted)\b.*)[.!]?$/i.test(text);
  }

  function responseTextErrorMessage(text) {
    var message = String(text || "").trim();
    if (/^\s*<(?:!doctype|html|head|body)\b/i.test(message)) {
      return "Apps Script returned an HTML page instead of an API response. Check that the Web App is deployed with public access.";
    }
    return message.slice(0, 240);
  }

  async function parseApiResponse(response, allowTextSuccess) {
    var responseText;
    try {
      responseText = await response.text();
    } catch (error) {
      throw new Error("Could not read the Apps Script response. Check the Web App deployment and try again.");
    }

    var text = String(responseText || "").trim();
    var payload;
    var isJson = false;
    if (text) {
      try {
        payload = JSON.parse(text);
        isJson = true;
      } catch (error) {
        payload = null;
      }
    }

    if (!response.ok) {
      var detail = payload && typeof payload === "object" && (payload.error || payload.message);
      detail = responseTextErrorMessage(detail || text);
      throw new Error("Apps Script returned HTTP " + response.status + (detail ? ": " + detail : "."));
    }
    if (!text && allowTextSuccess && response.status === 204) return { ok: true };
    if (!text) throw new Error("Apps Script returned an empty response.");

    if (!isJson || typeof payload === "string") {
      var textResponse = typeof payload === "string" ? payload.trim() : text;
      if (allowTextSuccess && isSuccessfulTextResponse(textResponse)) {
        return { ok: true, message: textResponse };
      }
      var textError = responseTextErrorMessage(textResponse) || "Apps Script returned an unexpected text response.";
      if (!allowTextSuccess) textError += " Login must return JSON containing a session token.";
      throw new Error(textError);
    }
    if (Array.isArray(payload)) {
      throw new Error("Apps Script returned an HSN list instead of the admin API response. Deploy the current apps-script/Code.gs file as a Web App.");
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Apps Script returned an unexpected response. Deploy the current apps-script/Code.gs file as a Web App.");
    }
    if (payload.ok === true || payload.success === true ||
        String(payload.status || "").toLowerCase() === "success") {
      return payload;
    }

    var message = payload.error || payload.message ||
      "Apps Script reported a failure without details. Confirm the deployed Web App supports this action.";
    if (/session|unauthori[sz]ed|token/i.test(message)) {
      sessionStorage.removeItem(SESSION_KEY);
      state.token = "";
    }
    throw new Error(message);
  }

  async function apiGet(action, token) {
    if (!API_URL || API_URL.indexOf("https://script.google.com/") !== 0) {
      throw new Error("Configure the Apps Script Web App URL in admin.html before signing in.");
    }
    var url = new URL(API_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("token", token);
    var response = await fetch(url.toString(), { method: "GET", cache: "no-store", credentials: "omit" });
    return parseApiResponse(response);
  }

  async function apiPost(payload) {
    if (!API_URL || API_URL.indexOf("https://script.google.com/") !== 0) {
      throw new Error("Configure the Apps Script Web App URL in admin.html before signing in.");
    }
    var response = await fetch(API_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return parseApiResponse(response, payload.action !== "login");
  }

  function showAdmin() {
    byId("login-screen").hidden = true;
    byId("admin-shell").hidden = false;
    switchAdminView("analytics");
  }

  function showLogin() {
    byId("admin-shell").hidden = true;
    byId("login-screen").hidden = false;
  }

  function normalizeHsn(values) {
    if (!Array.isArray(values)) return DEFAULT_HSN.slice();
    var usable = values.filter(function (item) {
      return item && String(item.Name || "").trim() && String(item.HSN || "").trim();
    }).map(function (item) {
      return { Name: String(item.Name).trim(), HSN: String(item.HSN).trim() };
    });
    return usable.length ? usable : DEFAULT_HSN.slice();
  }

  function setInvoices(values) {
    state.invoices = Array.isArray(values) ? values.filter(function (row) {
      return row && typeof row === "object";
    }) : [];
  }

  async function loadDashboard(token) {
    setSyncStatus("loading", "Syncing");
    var data = await apiGet("bootstrap", token);
    if (!data || !Array.isArray(data.invoices) || !Array.isArray(data.hsn)) {
      throw new Error("The Apps Script response is missing invoice or HSN data.");
    }
    setInvoices(data.invoices);
    state.hsn = normalizeHsn(data.hsn);
    renderAll();
    setSyncStatus("online", "Google Sheet synced");
  }

  async function beginSession(token) {
    state.token = token;
    try {
      await loadDashboard(token);
      showAdmin();
    } catch (error) {
      state.token = "";
      sessionStorage.removeItem(SESSION_KEY);
      setSyncStatus("error", "Sync unavailable");
      showLogin();
      throw error;
    }
  }

  function populateStates() {
    byId("customer-state").innerHTML = STATES.map(function (name) {
      return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + "</option>";
    }).join("");
    byId("customer-state").value = "Rajasthan";
  }

  function numberField(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function invoiceTaxable(invoice) {
    return round2([1, 2, 3, 4].reduce(function (sum, index) {
      return sum + numberField(invoice["Amount " + index]);
    }, 0));
  }

  function invoiceTax(invoice) {
    return round2(numberField(invoice["Total CGST"]) + numberField(invoice["Total SGST"]) + numberField(invoice["Total IGST"]));
  }

  function filteredInvoices() {
    var search = byId("search-input").value.trim().toLowerCase();
    var month = byId("month-filter").value;
    var from = byId("date-from").value;
    var to = byId("date-to").value;
    return state.invoices.filter(function (invoice) {
      var date = String(invoice.Date || "").slice(0, 10);
      var textMatch = !search ||
        String(invoice["Client Name"] || "").toLowerCase().indexOf(search) !== -1 ||
        String(invoice["Invoice No"] || "").toLowerCase().indexOf(search) !== -1;
      return textMatch &&
        (!month || date.slice(0, 7) === month) &&
        (!from || date >= from) &&
        (!to || date <= to);
    }).sort(function (a, b) {
      return String(b.Date || "").localeCompare(String(a.Date || "")) ||
        String(b["Invoice No"] || "").localeCompare(String(a["Invoice No"] || ""));
    });
  }

  function buildMonthOptions() {
    var select = byId("month-filter");
    var existing = select.value;
    var months = Array.from(new Set(state.invoices.map(function (invoice) {
      return String(invoice.Date || "").slice(0, 7);
    }).filter(function (value) {
      return /^\d{4}-\d{2}$/.test(value);
    }))).sort().reverse();
    select.innerHTML = '<option value="">All months</option>' + months.map(function (month) {
      var date = new Date(month + "-01T00:00:00");
      var label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date);
      return '<option value="' + month + '">' + escapeHtml(label) + "</option>";
    }).join("");
    if (months.indexOf(existing) !== -1) select.value = existing;
  }

  function renderSummary(invoices) {
    var customers = invoices.filter(function (invoice) {
      return String(invoice.Type || "customer").toLowerCase() === "customer";
    });
    var revenue = customers.reduce(function (sum, invoice) { return sum + numberField(invoice["Total Amount"]); }, 0);
    var taxable = customers.reduce(function (sum, invoice) { return sum + invoiceTaxable(invoice); }, 0);
    var tax = customers.reduce(function (sum, invoice) { return sum + invoiceTax(invoice); }, 0);
    byId("summary-revenue").textContent = formatMoney(revenue);
    byId("summary-taxable").textContent = formatMoney(taxable);
    byId("summary-gst").textContent = formatMoney(tax);
    byId("summary-count").textContent = String(invoices.length);
  }

  function renderInvoiceTable() {
    var invoices = filteredInvoices();
    renderSummary(invoices);
    var body = byId("invoice-table-body");
    byId("empty-state").hidden = invoices.length > 0;
    body.innerHTML = invoices.map(function (invoice) {
      var invoiceNo = String(invoice["Invoice No"] || "");
      var type = String(invoice.Type || "customer").toLowerCase();
      var typeLabel = type === "vendor/expense" ? "Vendor / expense" : "Customer";
      var pillClass = type === "vendor/expense" ? "type-pill vendor" : "type-pill";
      return "<tr>" +
        "<td>" + escapeHtml(invoiceNo || "—") + "</td>" +
        "<td>" + escapeHtml(displayDate(invoice.Date)) + "</td>" +
        "<td>" + escapeHtml(invoice["Client Name"] || "—") + "</td>" +
        '<td><span class="' + pillClass + '">' + escapeHtml(typeLabel) + "</span></td>" +
        '<td class="numeric">' + escapeHtml(formatMoney(invoiceTaxable(invoice))) + "</td>" +
        '<td class="numeric">' + escapeHtml(formatMoney(invoiceTax(invoice))) + "</td>" +
        '<td class="numeric">' + escapeHtml(formatMoney(invoice["Total Amount"])) + "</td>" +
        '<td><div class="row-actions">' +
        '<button class="row-action" type="button" data-action="view" data-invoice="' + escapeHtml(invoiceNo) + '">View / Print</button>' +
        '<button class="row-action" type="button" data-action="edit" data-invoice="' + escapeHtml(invoiceNo) + '">Edit</button>' +
        '<button class="row-action delete" type="button" data-action="delete" data-invoice="' + escapeHtml(invoiceNo) + '">Delete</button>' +
        "</div></td></tr>";
    }).join("");
    byId("invoice-count-label").textContent = invoices.length + (invoices.length === 1 ? " invoice" : " invoices");
  }

  function renderAll() {
    buildMonthOptions();
    renderInvoiceTable();
    if (!byId("admin-shell").hidden && !byId("analytics-view").hidden) {
      renderAnalytics();
    } else {
      destroyAnalyticsCharts();
    }
  }

  function analyticsInvoices() {
    var range = state.analyticsRange;
    return state.invoices.filter(function (invoice) {
      var date = String(invoice.Date || "").slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        (!range.from || date >= range.from) &&
        (!range.to || date <= range.to);
    });
  }

  function chartMoney(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1
    }).format(numberField(value));
  }

  function destroyAnalyticsCharts() {
    Object.keys(state.analyticsCharts).forEach(function (name) {
      state.analyticsCharts[name].destroy();
    });
    state.analyticsCharts = {};
  }

  function renderRecentTransactions(invoices) {
    var recent = invoices.slice().sort(function (a, b) {
      return String(b.Date || "").localeCompare(String(a.Date || "")) ||
        String(b["Invoice No"] || "").localeCompare(String(a["Invoice No"] || ""));
    }).slice(0, 5);
    byId("recent-empty-state").hidden = recent.length > 0;
    byId("recent-transactions-body").innerHTML = recent.map(function (invoice) {
      var services = [1, 2, 3, 4].map(function (index) {
        return String(invoice["Service " + index] || "").trim();
      }).filter(Boolean);
      var label = services.filter(function (service, index) {
        return services.indexOf(service) === index;
      }).slice(0, 2).join(", ") || "—";
      if (services.length > 2) label += " + more";
      var invoiceNo = String(invoice["Invoice No"] || "");
      return "<tr><td>" + escapeHtml(invoiceNo || "—") + "</td>" +
        "<td>" + escapeHtml(displayDate(invoice.Date)) + "</td>" +
        "<td>" + escapeHtml(invoice["Client Name"] || "—") + "</td>" +
        "<td>" + escapeHtml(label) + "</td>" +
        '<td class="numeric">' + escapeHtml(formatMoney(invoice["Total Amount"])) + "</td>" +
        '<td><button class="row-action" type="button" data-action="view" data-invoice="' + escapeHtml(invoiceNo) + '">View</button></td></tr>';
    }).join("");
  }

  function aggregateServiceRevenue(invoices) {
    var groups = {};
    invoices.forEach(function (invoice) {
      [1, 2, 3, 4].forEach(function (index) {
        var amount = numberField(invoice["Amount " + index]);
        var service = String(invoice["Service " + index] || "").trim();
        if (!service || amount <= 0) return;
        var key = service.toLowerCase();
        if (!groups[key]) groups[key] = { label: service, value: 0 };
        groups[key].value += amount;
      });
    });
    return Object.keys(groups).map(function (key) {
      return groups[key];
    }).sort(function (a, b) { return b.value - a.value; });
  }

  function renderAnalyticsCharts(invoices) {
    destroyAnalyticsCharts();
    if (typeof window.Chart !== "function") return;

    var colors = ["#2563eb", "#10b981", "#f59e0b", "#0f172a", "#8b5cf6", "#06b6d4", "#f97316"];
    var monthGroups = {};
    invoices.forEach(function (invoice) {
      var month = String(invoice.Date || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      if (!monthGroups[month]) monthGroups[month] = { taxable: 0, gst: 0 };
      monthGroups[month].taxable += invoiceTaxable(invoice);
      monthGroups[month].gst += invoiceTax(invoice);
    });
    var months = Object.keys(monthGroups).sort();
    var currencyTooltip = {
      callbacks: {
        label: function (context) {
          var value = typeof context.parsed === "number" ? context.parsed :
            (context.parsed.y == null ? context.parsed.x : context.parsed.y);
          return context.dataset.label + ": " + formatMoney(value);
        }
      }
    };
    var common = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: "#475569", font: { size: 10 } } },
        tooltip: currencyTooltip
      }
    };

    state.analyticsCharts.monthly = new window.Chart(byId("monthly-chart"), {
      type: "bar",
      data: {
        labels: months,
        datasets: [
          { type: "bar", label: "Taxable sales", data: months.map(function (month) { return round2(monthGroups[month].taxable); }), backgroundColor: "rgba(37,99,235,.78)", borderRadius: 4, yAxisID: "y" },
          { type: "line", label: "GST collected", data: months.map(function (month) { return round2(monthGroups[month].gst); }), borderColor: "#10b981", backgroundColor: "#10b981", pointRadius: 3, pointHoverRadius: 5, tension: .35, yAxisID: "y1" }
        ]
      },
      options: Object.assign({}, common, {
        scales: {
          x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 9 } } },
          y: { beginAtZero: true, grid: { color: "#eef2f7" }, ticks: { color: "#64748b", callback: chartMoney } },
          y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#64748b", callback: chartMoney } }
        }
      })
    });

    var services = aggregateServiceRevenue(invoices);
    var serviceTotal = services.reduce(function (sum, item) { return sum + item.value; }, 0);
    state.analyticsCharts.services = new window.Chart(byId("service-chart"), {
      type: "doughnut",
      data: {
        labels: services.map(function (item) { return item.label; }),
        datasets: [{ data: services.map(function (item) { return round2(item.value); }), backgroundColor: services.map(function (_, index) { return colors[index % colors.length]; }), borderColor: "#fff", borderWidth: 3, hoverOffset: 6 }]
      },
      options: Object.assign({}, common, {
        cutout: "62%",
        plugins: Object.assign({}, common.plugins, {
          tooltip: { callbacks: { label: function (context) {
            var value = numberField(context.parsed);
            var percentage = serviceTotal ? (value / serviceTotal * 100) : 0;
            return context.label + ": " + formatMoney(value) + " (" + percentage.toFixed(1) + "%)";
          } } }
        })
      })
    });

    var gstValues = [
      invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total CGST"]); }, 0),
      invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total SGST"]); }, 0),
      invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total IGST"]); }, 0)
    ];
    state.analyticsCharts.gst = new window.Chart(byId("gst-chart"), {
      type: "pie",
      data: { labels: ["CGST", "SGST", "IGST"], datasets: [{ data: gstValues.map(round2), backgroundColor: ["#2563eb", "#10b981", "#f59e0b"], borderColor: "#fff", borderWidth: 3, hoverOffset: 6 }] },
      options: Object.assign({}, common, {
        plugins: Object.assign({}, common.plugins, {
          tooltip: { callbacks: { label: function (context) { return context.label + ": " + formatMoney(context.parsed); } } }
        })
      })
    });

    var clients = {};
    invoices.forEach(function (invoice) {
      var name = String(invoice["Client Name"] || "").trim();
      if (!name) return;
      var key = name.toLowerCase();
      if (!clients[key]) clients[key] = { label: name, value: 0 };
      clients[key].value += numberField(invoice["Total Amount"]);
    });
    var topClients = Object.keys(clients).map(function (key) { return clients[key]; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 5);
    state.analyticsCharts.clients = new window.Chart(byId("clients-chart"), {
      type: "bar",
      data: { labels: topClients.map(function (client) { return client.label; }), datasets: [{ label: "Billed", data: topClients.map(function (client) { return round2(client.value); }), backgroundColor: "rgba(37,99,235,.78)", borderRadius: 4 }] },
      options: Object.assign({}, common, {
        indexAxis: "y",
        plugins: Object.assign({}, common.plugins, {
          legend: { display: false },
          tooltip: { callbacks: { label: function (context) { return "Billed: " + formatMoney(context.parsed.x); } } }
        }),
        scales: {
          x: { beginAtZero: true, grid: { color: "#eef2f7" }, ticks: { color: "#64748b", callback: chartMoney } },
          y: { grid: { display: false }, ticks: { color: "#475569", font: { size: 10 } } }
        }
      })
    });
  }

  function renderAnalytics() {
    var range = state.analyticsRange;
    var filterError = byId("analytics-filter-error");
    filterError.hidden = !(range.from && range.to && range.from > range.to);
    filterError.textContent = filterError.hidden ? "" : "The start date must be on or before the end date.";
    var invoices = analyticsInvoices();
    var revenue = invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total Amount"]); }, 0);
    var taxable = invoices.reduce(function (sum, invoice) { return sum + invoiceTaxable(invoice); }, 0);
    var cgst = invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total CGST"]); }, 0);
    var sgst = invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total SGST"]); }, 0);
    var igst = invoices.reduce(function (sum, invoice) { return sum + numberField(invoice["Total IGST"]); }, 0);
    byId("analytics-revenue").textContent = formatMoney(revenue);
    byId("analytics-taxable").textContent = formatMoney(taxable);
    byId("analytics-gst").textContent = formatMoney(cgst + sgst + igst);
    byId("analytics-gst-split").textContent = "CGST " + formatMoney(cgst) + " · SGST " + formatMoney(sgst) + " · IGST " + formatMoney(igst);
    byId("analytics-invoice-count").textContent = invoices.length + (invoices.length === 1 ? " invoice" : " invoices");
    byId("analytics-average-ticket").textContent = "Average ticket " + formatMoney(invoices.length ? revenue / invoices.length : 0);
    byId("analytics-period-label").textContent = range.label;
    renderRecentTransactions(invoices);
    renderAnalyticsCharts(invoices);
    var chartWarning = byId("analytics-chart-warning");
    chartWarning.hidden = typeof window.Chart === "function";
    chartWarning.textContent = chartWarning.hidden ? "" : "Charts are unavailable because Chart.js did not load. Check your internet connection and reload the dashboard.";
  }

  function setAnalyticsPreset(preset) {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var from = "";
    var to = "";
    var label = "All time";
    if (preset === "this-month") {
      from = [year, String(month + 1).padStart(2, "0"), "01"].join("-");
      to = localDateValue();
      label = "This month";
    } else if (preset === "last-month") {
      var lastMonth = new Date(year, month - 1, 1);
      from = [lastMonth.getFullYear(), String(lastMonth.getMonth() + 1).padStart(2, "0"), "01"].join("-");
      var lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).getDate();
      to = [lastMonth.getFullYear(), String(lastMonth.getMonth() + 1).padStart(2, "0"), String(lastDay).padStart(2, "0")].join("-");
      label = "Last month";
    } else if (preset === "fy-2026-27") {
      from = "2026-04-01";
      to = "2027-03-31";
      label = "FY 2026-27";
    }
    state.analyticsRange = { from: from, to: to, label: label };
    byId("analytics-date-from").value = from;
    byId("analytics-date-to").value = to;
    document.querySelectorAll("[data-range-preset]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.rangePreset === preset);
    });
    renderAnalytics();
  }

  function setCustomAnalyticsRange() {
    var from = byId("analytics-date-from").value;
    var to = byId("analytics-date-to").value;
    var label = "Custom range";
    if (from && to) label = displayDate(from) + " – " + displayDate(to);
    else if (from) label = "From " + displayDate(from);
    else if (to) label = "Through " + displayDate(to);
    state.analyticsRange = { from: from, to: to, label: label };
    document.querySelectorAll("[data-range-preset]").forEach(function (button) {
      button.classList.remove("is-active");
    });
    renderAnalytics();
  }

  function switchAdminView(view) {
    var analyticsSelected = view !== "billing";
    byId("analytics-view").hidden = !analyticsSelected;
    byId("billing-view").hidden = analyticsSelected;
    byId("analytics-tab").classList.toggle("is-active", analyticsSelected);
    byId("billing-tab").classList.toggle("is-active", !analyticsSelected);
    byId("analytics-tab").setAttribute("aria-selected", String(analyticsSelected));
    byId("billing-tab").setAttribute("aria-selected", String(!analyticsSelected));
    if (analyticsSelected) renderAnalytics();
  }

  function getCurrentLines() {
    return Array.from(byId("line-items").querySelectorAll(".line-item")).map(function (row) {
      return {
        service: row.querySelector(".line-service").value,
        description: row.querySelector(".line-description").value.trim(),
        rate: Number(row.querySelector(".line-rate").value),
        amount: numberField(row.querySelector(".line-amount").value)
      };
    });
  }

  function lineItemMarkup(item, index) {
    var serviceOptions = '<option value="">Choose a service</option>' + state.hsn.map(function (service) {
      var name = String(service.Name);
      var selected = name === String(item.service || "") ? " selected" : "";
      return '<option value="' + escapeHtml(name) + '"' + selected + ">" + escapeHtml(name) + "</option>";
    }).join("");
    var rateOptions = RATES.map(function (rate) {
      var selected = Number(item.rate == null ? 18 : item.rate) === rate ? " selected" : "";
      return '<option value="' + rate + '"' + selected + ">" + rate + "%</option>";
    }).join("");
    return '<div class="line-item" data-index="' + index + '">' +
      '<div class="line-control service-control"><label>Service ' + (index + 1) + '</label><select class="line-service" required>' + serviceOptions + '</select><span class="hsn-code"></span></div>' +
      '<div class="line-control description-control"><label>Description</label><input class="line-description" maxlength="160" placeholder="Travel service details" value="' + escapeHtml(item.description || "") + '"></div>' +
      '<div class="line-control rate-control"><label>Tax rate</label><select class="line-rate">' + rateOptions + "</select></div>" +
      '<div class="line-control amount-control"><label>Taxable amount (₹)</label><input class="line-amount" type="number" min="0" step="0.01" value="' + escapeHtml(item.amount == null ? "" : item.amount) + '" placeholder="0.00" required></div>' +
      '<button class="remove-line" type="button" aria-label="Remove service line ' + (index + 1) + '">×</button></div>';
  }

  function updateHsnLabel(row) {
    var name = row.querySelector(".line-service").value;
    var match = state.hsn.find(function (item) { return item.Name === name; });
    row.querySelector(".hsn-code").textContent = match ? "HSN/SAC: " + match.HSN : "HSN/SAC appears when a service is selected";
  }

  function renderLineItems(items) {
    var lineItems = items.length ? items.slice(0, 4) : [{ service: "", description: "", rate: 18, amount: "" }];
    state.renderedLines = lineItems.length;
    byId("line-items").innerHTML = lineItems.map(lineItemMarkup).join("");
    byId("line-items").querySelectorAll(".line-item").forEach(function (row) {
      updateHsnLabel(row);
    });
    byId("add-line-button").disabled = state.renderedLines >= 4;
    updateTotals();
  }

  function calculateTotals(lines, customerState) {
    var taxable = 0;
    var cgst = 0;
    var sgst = 0;
    var igst = 0;
    lines.forEach(function (line) {
      var amount = round2(line.amount || 0);
      var tax = round2(amount * Number(line.rate || 0) / 100);
      taxable += amount;
      if (String(customerState || "").trim().toLowerCase() === "rajasthan") {
        var half = round2(tax / 2);
        cgst += half;
        sgst += round2(tax - half);
      } else {
        igst += tax;
      }
    });
    taxable = round2(taxable);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    return { taxable: taxable, cgst: cgst, sgst: sgst, igst: igst, total: round2(taxable + cgst + sgst + igst) };
  }

  function updateTotals() {
    var lines = getCurrentLines();
    var totals = calculateTotals(lines, byId("customer-state").value);
    byId("calc-taxable").textContent = formatMoney(totals.taxable);
    byId("calc-cgst").textContent = formatMoney(totals.cgst);
    byId("calc-sgst").textContent = formatMoney(totals.sgst);
    byId("calc-igst").textContent = formatMoney(totals.igst);
    byId("calc-total").textContent = formatMoney(totals.total);
  }

  function nextInvoiceNumber(year) {
    var selectedYear = String(year || new Date().getFullYear());
    var highest = 0;
    state.invoices.forEach(function (invoice) {
      var match = String(invoice["Invoice No"] || "").match(/^STT\/(\d{4})\/(\d+)$/i);
      if (match && match[1] === selectedYear) highest = Math.max(highest, Number(match[2]));
    });
    return "STT/" + selectedYear + "/" + String(highest + 1).padStart(3, "0");
  }

  function showEditor() {
    byId("editor-panel").hidden = false;
    byId("editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    byId("client-name").focus({ preventScroll: true });
  }

  function hideEditor() {
    byId("editor-panel").hidden = true;
  }

  function resetEditor() {
    state.editing = false;
    byId("invoice-form").reset();
    byId("editor-title").textContent = "Create invoice";
    byId("save-invoice-button").querySelector(".button-label").textContent = "Save invoice";
    byId("editing-original-number").value = "";
    byId("invoice-date").value = localDateValue();
    byId("invoice-type").value = "customer";
    byId("customer-state").value = "Rajasthan";
    byId("invoice-number").value = nextInvoiceNumber(byId("invoice-date").value.slice(0, 4));
    renderLineItems([{ service: "", description: "", rate: 18, amount: "" }]);
  }

  function editInvoice(invoice) {
    state.editing = true;
    byId("editor-title").textContent = "Edit invoice";
    byId("save-invoice-button").querySelector(".button-label").textContent = "Update invoice";
    byId("editing-original-number").value = String(invoice["Invoice No"] || "");
    byId("invoice-number").value = String(invoice["Invoice No"] || "");
    byId("invoice-date").value = String(invoice.Date || "").slice(0, 10) || localDateValue();
    byId("invoice-type").value = String(invoice.Type || "customer");
    byId("client-name").value = String(invoice["Client Name"] || "");
    byId("customer-state").value = String(invoice["Customer State"] || "Rajasthan");
    byId("customer-address").value = String(invoice["Customer Address"] || "");
    var lines = [];
    for (var index = 1; index <= 4; index += 1) {
      var service = String(invoice["Service " + index] || "");
      var description = String(invoice["Description " + index] || "");
      var amount = numberField(invoice["Amount " + index]);
      if (service || description || amount) {
        lines.push({
          service: service,
          description: description,
          rate: numberField(invoice["Tax Rate " + index]),
          amount: amount
        });
      }
    }
    renderLineItems(lines);
    showEditor();
  }

  function validateAndReadForm() {
    var form = byId("invoice-form");
    if (!form.reportValidity()) return null;
    var lines = getCurrentLines();
    var activeLines = lines.filter(function (line) {
      return line.service || line.description || line.amount;
    });
    if (!activeLines.length) throw new Error("Add at least one service line before saving.");
    activeLines.forEach(function (line, index) {
      if (!line.service) throw new Error("Choose a service for line " + (index + 1) + ".");
      if (!Number.isFinite(line.amount) || line.amount <= 0) throw new Error("Enter a taxable amount greater than zero for line " + (index + 1) + ".");
      if (RATES.indexOf(line.rate) === -1) throw new Error("Select a valid GST rate for each line.");
    });
    if (activeLines.length > 4) throw new Error("An invoice can contain up to four service lines.");
    var totals = calculateTotals(activeLines, byId("customer-state").value);
    return {
      "Invoice No": byId("invoice-number").value.trim(),
      "Date": byId("invoice-date").value,
      "Type": byId("invoice-type").value,
      "Client Name": byId("client-name").value.trim(),
      "Customer State": byId("customer-state").value,
      "Customer Address": byId("customer-address").value.trim(),
      "lines": activeLines,
      "Total CGST": totals.cgst,
      "Total SGST": totals.sgst,
      "Total IGST": totals.igst,
      "Total Amount": totals.total
    };
  }

  function rowToCsv(invoice) {
    return INVOICE_HEADERS.map(function (header) {
      var value = invoice[header] == null ? "" : invoice[header];
      return '"' + String(value).replace(/"/g, '""') + '"';
    }).join(",");
  }

  function exportCsv() {
    var invoices = filteredInvoices();
    var rows = [INVOICE_HEADERS.map(function (header) { return '"' + header.replace(/"/g, '""') + '"'; }).join(",")];
    invoices.forEach(function (invoice) { rows.push(rowToCsv(invoice)); });
    var blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "sonu-tour-travel-invoices-" + localDateValue() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    showToast("CSV exported (" + invoices.length + " invoice" + (invoices.length === 1 ? "" : "s") + ").", false);
  }

  var SMALL_NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  var TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function wordsUnderThousand(value) {
    var number = Math.floor(value);
    var words = [];
    if (number >= 100) {
      words.push(SMALL_NUMBERS[Math.floor(number / 100)], "Hundred");
      number %= 100;
    }
    if (number >= 20) {
      words.push(TENS[Math.floor(number / 10)]);
      number %= 10;
    }
    if (number > 0) words.push(SMALL_NUMBERS[number]);
    return words.join(" ");
  }

  function amountInWords(value) {
    var paiseTotal = Math.round(Number(value) * 100);
    var rupees = Math.floor(paiseTotal / 100);
    var paise = paiseTotal % 100;
    var groups = [
      [10000000, "Crore"],
      [100000, "Lakh"],
      [1000, "Thousand"],
      [1, ""]
    ];
    var remaining = rupees;
    var words = [];
    groups.forEach(function (group) {
      if (remaining >= group[0]) {
        var amount = Math.floor(remaining / group[0]);
        remaining %= group[0];
        words.push(wordsUnderThousand(amount) + (group[1] ? " " + group[1] : ""));
      }
    });
    if (!words.length) words.push("Zero");
    var result = "Rupees " + words.join(" ");
    if (paise) result += " and " + wordsUnderThousand(paise) + (paise === 1 ? " Paise" : " Paise");
    return result + " Only";
  }

  function lineTaxDetails(lines, customerState) {
    var intra = String(customerState || "").trim().toLowerCase() === "rajasthan";
    return lines.map(function (line) {
      var tax = round2(line.amount * line.rate / 100);
      var cgst = intra ? round2(tax / 2) : 0;
      var sgst = intra ? round2(tax - cgst) : 0;
      var igst = intra ? 0 : tax;
      var hsn = state.hsn.find(function (item) { return item.Name === line.service; });
      return {
        service: line.service,
        description: line.description,
        hsn: hsn ? hsn.HSN : "—",
        rate: line.rate,
        amount: round2(line.amount),
        cgst: cgst,
        sgst: sgst,
        igst: igst,
        total: round2(line.amount + tax)
      };
    });
  }

  function getInvoiceLines(invoice) {
    var lines = [];
    for (var index = 1; index <= 4; index += 1) {
      var service = String(invoice["Service " + index] || "");
      var description = String(invoice["Description " + index] || "");
      var amount = numberField(invoice["Amount " + index]);
      if (service || description || amount) {
        lines.push({
          service: service,
          description: description,
          rate: numberField(invoice["Tax Rate " + index]),
          amount: amount
        });
      }
    }
    return lines;
  }

  function previewInvoice(invoice) {
    var customerState = String(invoice["Customer State"] || "Rajasthan");
    var details = lineTaxDetails(getInvoiceLines(invoice), customerState);
    var isExpense = String(invoice.Type || "customer").toLowerCase() === "vendor/expense";
    var rows = details.map(function (line, index) {
      return "<tr><td>" + (index + 1) + "<br><strong>" + escapeHtml(line.service) + "</strong>" +
        (line.description ? "<br>" + escapeHtml(line.description) : "") + "</td>" +
        "<td>" + escapeHtml(line.hsn) + "</td><td>" + escapeHtml(formatMoney(line.amount)) + "</td>" +
        "<td>" + escapeHtml(line.rate) + "%</td><td>" + escapeHtml(formatMoney(line.cgst)) + "</td>" +
        "<td>" + escapeHtml(formatMoney(line.sgst)) + "</td><td>" + escapeHtml(formatMoney(line.igst)) + "</td>" +
        "<td>" + escapeHtml(formatMoney(line.total)) + "</td></tr>";
    }).join("");
    var address = escapeHtml(invoice["Customer Address"] || "").replace(/\n/g, "<br>");
    var total = numberField(invoice["Total Amount"]);
    var companyAddress = "Shop No. 16, Shitala Market, Vallabhnagar, Udaipur, Rajasthan";
    byId("invoice-paper").innerHTML =
      '<div class="invoice-top"><div class="invoice-company"><img src="assets/logo.png" alt=""><div><h2>Sonu Tour &amp; Travel</h2>' +
      "<p>" + companyAddress + "</p><p><strong>GSTIN:</strong> [Enter company GSTIN]</p>" +
      "<p><strong>Phone:</strong> +91 8963076586 &nbsp; <strong>Email:</strong> sonutourtraval@gmail.com</p></div></div>" +
      '<div class="invoice-title"><h1>' + (isExpense ? "PURCHASE / EXPENSE" : "TAX INVOICE") + "</h1><strong>" + escapeHtml(invoice["Invoice No"] || "") +
      "</strong><small>Date: " + escapeHtml(displayDate(invoice.Date)) + "</small><small>Place of supply: " + escapeHtml(customerState) + "</small></div></div>" +
      '<div class="invoice-parties"><div><h3>' + (isExpense ? "Vendor details" : "Bill to") + "</h3><strong>" + escapeHtml(invoice["Client Name"] || "") +
      "</strong><p>" + (address || "Address not provided") + "</p><p>State: " + escapeHtml(customerState) + "</p></div>" +
      "<div><h3>Invoice information</h3><p><strong>Invoice type:</strong> " + (isExpense ? "Vendor / expense" : "Customer sale") +
      "</p><p><strong>GST treatment:</strong> " + (customerState.toLowerCase() === "rajasthan" ? "CGST + SGST" : "IGST") + "</p></div></div>" +
      '<table class="invoice-lines"><thead><tr><th>Service / description</th><th>HSN/SAC</th><th>Taxable</th><th>Rate</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Line total</th></tr></thead><tbody>' +
      rows + "</tbody></table>" +
      '<div class="invoice-totals"><div><span>Taxable value</span><strong>' + escapeHtml(formatMoney(invoiceTaxable(invoice))) + "</strong></div>" +
      "<div><span>Total CGST</span><strong>" + escapeHtml(formatMoney(invoice["Total CGST"])) + "</strong></div>" +
      "<div><span>Total SGST</span><strong>" + escapeHtml(formatMoney(invoice["Total SGST"])) + "</strong></div>" +
      "<div><span>Total IGST</span><strong>" + escapeHtml(formatMoney(invoice["Total IGST"])) + "</strong></div>" +
      '<div class="invoice-grand"><span>Total amount</span><strong>' + escapeHtml(formatMoney(total)) + "</strong></div></div>" +
      '<div class="invoice-words"><strong>Amount in words:</strong> ' + escapeHtml(amountInWords(total)) + "</div>" +
      '<div class="invoice-bank"><h3>Bank details</h3><p>[Enter bank name] &nbsp; | &nbsp; <strong>A/C:</strong> [Enter account number] &nbsp; | &nbsp; <strong>IFSC:</strong> [Enter IFSC code]</p></div>' +
      '<div class="invoice-signature"><div><strong>For Sonu Tour &amp; Travel</strong><span>Authorized Signatory</span></div></div>' +
      '<div class="invoice-foot">Thank you for your business. This is a computer-generated invoice.</div>';
    byId("invoice-modal").hidden = false;
    byId("close-preview").focus();
  }

  function handleTableAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var invoiceNo = button.dataset.invoice;
    var invoice = state.invoices.find(function (row) { return String(row["Invoice No"]) === invoiceNo; });
    if (!invoice) {
      showToast("That invoice is no longer in the synced list. Refresh and try again.", true);
      return;
    }
    if (button.dataset.action === "view") {
      previewInvoice(invoice);
    } else if (button.dataset.action === "edit") {
      editInvoice(invoice);
    } else if (button.dataset.action === "delete") {
      deleteInvoice(invoice);
    }
  }

  async function deleteInvoice(invoice) {
    if (!window.confirm("Delete invoice " + invoice["Invoice No"] + "? This will remove it from the Google Sheet.")) return;
    setSyncStatus("loading", "Deleting");
    try {
      await apiPost({ action: "deleteInvoice", token: state.token, invoiceNo: invoice["Invoice No"] });
      state.invoices = state.invoices.filter(function (row) {
        return String(row["Invoice No"]) !== String(invoice["Invoice No"]);
      });
      renderAll();
      setSyncStatus("online", "Google Sheet synced");
      showToast("Invoice deleted.", false);
    } catch (error) {
      setSyncStatus("error", "Sync error");
      showToast(apiErrorMessage(error), true);
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        switchAdminView(button.dataset.view);
      });
    });
    document.querySelectorAll("[data-open-billing]").forEach(function (button) {
      button.addEventListener("click", function () {
        switchAdminView("billing");
      });
    });
    document.querySelectorAll("[data-range-preset]").forEach(function (button) {
      button.addEventListener("click", function () {
        setAnalyticsPreset(button.dataset.rangePreset);
      });
    });
    ["analytics-date-from", "analytics-date-to"].forEach(function (id) {
      byId(id).addEventListener("change", setCustomAnalyticsRange);
    });

    byId("login-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      setLoginError("");
      var button = event.currentTarget.querySelector('button[type="submit"]');
      setButtonLoading(button, true);
      try {
        var pin = String(byId("login-password").value || "").trim();
        if (!pin) throw new Error("Enter your admin PIN or password.");
        var result = await apiPost({ action: "login", password: pin });
        if (!result.token || typeof result.token !== "string") throw new Error("The Apps Script did not return a valid session.");
        byId("login-password").value = "";
        sessionStorage.setItem(SESSION_KEY, result.token);
        await beginSession(result.token);
      } catch (error) {
        setLoginError(apiErrorMessage(error));
      } finally {
        setButtonLoading(button, false);
      }
    });

    byId("logout-button").addEventListener("click", async function () {
      var token = state.token;
      sessionStorage.removeItem(SESSION_KEY);
      state.token = "";
      showLogin();
      setLoginError("");
      if (token) {
        try {
          await apiPost({ action: "logout", token: token });
        } catch (error) {
          showToast("Signed out on this device. The remote session will expire automatically.", true);
        }
      }
    });

    byId("new-invoice-button").addEventListener("click", function () {
      resetEditor();
      showEditor();
    });
    byId("close-editor").addEventListener("click", hideEditor);
    byId("cancel-editor").addEventListener("click", hideEditor);
    byId("add-line-button").addEventListener("click", function () {
      if (state.renderedLines >= 4) return;
      var lines = getCurrentLines();
      lines.push({ service: "", description: "", rate: 18, amount: "" });
      renderLineItems(lines);
    });
    byId("line-items").addEventListener("input", updateTotals);
    byId("line-items").addEventListener("change", function (event) {
      if (event.target.classList.contains("line-service")) updateHsnLabel(event.target.closest(".line-item"));
      updateTotals();
    });
    byId("line-items").addEventListener("click", function (event) {
      var button = event.target.closest(".remove-line");
      if (!button) return;
      var rows = getCurrentLines();
      var index = Number(button.closest(".line-item").dataset.index);
      rows.splice(index, 1);
      renderLineItems(rows);
    });
    byId("customer-state").addEventListener("change", updateTotals);
    byId("invoice-date").addEventListener("change", function () {
      if (!state.editing) byId("invoice-number").value = nextInvoiceNumber(byId("invoice-date").value.slice(0, 4));
    });
    byId("invoice-form").addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = byId("save-invoice-button");
      try {
        var invoice = validateAndReadForm();
        if (!invoice) return;
        button.classList.add("is-loading");
        button.disabled = true;
        setSyncStatus("loading", "Saving");
        await apiPost({
          action: state.editing ? "updateInvoice" : "saveInvoice",
          token: state.token,
          originalInvoiceNo: byId("editing-original-number").value,
          invoice: invoice
        });
        await loadDashboard(state.token);
        hideEditor();
        showToast(state.editing ? "Invoice updated and synced." : "Invoice saved and synced.", false);
        state.editing = false;
      } catch (error) {
        setSyncStatus("error", "Sync error");
        showToast(apiErrorMessage(error), true);
      } finally {
        button.classList.remove("is-loading");
        button.disabled = false;
      }
    });

    ["search-input", "month-filter", "date-from", "date-to"].forEach(function (id) {
      byId(id).addEventListener("input", renderInvoiceTable);
      byId(id).addEventListener("change", renderInvoiceTable);
    });
    byId("clear-filters").addEventListener("click", function () {
      byId("search-input").value = "";
      byId("month-filter").value = "";
      byId("date-from").value = "";
      byId("date-to").value = "";
      renderInvoiceTable();
    });
    byId("export-button").addEventListener("click", exportCsv);
    byId("invoice-table-body").addEventListener("click", handleTableAction);
    byId("recent-transactions-body").addEventListener("click", handleTableAction);
    byId("close-preview").addEventListener("click", function () { byId("invoice-modal").hidden = true; });
    byId("invoice-modal").addEventListener("click", function (event) {
      if (event.target.hasAttribute("data-close-preview")) byId("invoice-modal").hidden = true;
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") byId("invoice-modal").hidden = true;
    });
    byId("print-invoice-button").addEventListener("click", function () {
      var oldTitle = document.title;
      var invoiceNumber = byId("invoice-paper").querySelector(".invoice-title strong");
      document.title = "GST-Invoice-" + (invoiceNumber ? invoiceNumber.textContent.replace(/[^\w-]/g, "-") : "Sonu-Tour-Travel");
      window.print();
      window.setTimeout(function () { document.title = oldTitle; }, 500);
    });
  }

  async function initialize() {
    populateStates();
    renderLineItems([{ service: "", description: "", rate: 18, amount: "" }]);
    bindEvents();
    var token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return;
    try {
      await beginSession(token);
    } catch (error) {
      setLoginError(apiErrorMessage(error));
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
}());
