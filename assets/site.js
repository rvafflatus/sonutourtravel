document.addEventListener("DOMContentLoaded", function () {
  var menuButton = document.querySelector(".menu-toggle");
  var menu = document.querySelector(".nav-links");

  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      var isOpen = menu.classList.toggle("is-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menu.classList.remove("is-open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation menu");
      });
    });
  }

  document.querySelectorAll(".whatsapp-link[data-message]").forEach(function (link) {
    link.href = "https://wa.me/918963076586?text=" + encodeURIComponent(link.dataset.message);
  });

  var form = document.getElementById("enquiry-form");
  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;

      var data = new FormData(form);
      var message = [
        "Hello Sonu Tour Travel, I'd like to make a travel enquiry.",
        "",
        "Name: " + data.get("name"),
        "Phone: " + data.get("phone"),
        "Service: " + data.get("service"),
        "Travel plans: " + (data.get("message") || "I'd like to discuss my plans.")
      ].join("\n");
      window.open("https://wa.me/918963076586?text=" + encodeURIComponent(message), "_blank", "noopener,noreferrer");
    });
  }

  var year = document.querySelector("[data-current-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  var filters = document.querySelectorAll("[data-tour-filter]");
  var tours = document.querySelectorAll(".tour-card[data-category]");
  filters.forEach(function (button) {
    button.addEventListener("click", function () {
      var selected = button.dataset.tourFilter;
      filters.forEach(function (filter) {
        filter.setAttribute("aria-pressed", String(filter === button));
      });
      tours.forEach(function (tour) {
        tour.hidden = selected !== "all" && tour.dataset.category !== selected;
      });
    });
  });
});
