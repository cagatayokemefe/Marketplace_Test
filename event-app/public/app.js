/* ════════════════════════════════════════════════════════════════════════════
   MeetApp — istemci uygulaması
   Tek sayfalık, hash tabanlı yönlendirici. Derleme adımı yok; hem tarayıcıda
   hem de Capacitor ile paketlenmiş native kabukta aynı dosya çalışır.

   Ekrandaki tüm metinler i18n.js'teki sözlükten gelir; dil değişince görünüm
   yeniden çizilir. Sunucu mesajları için seçilen dil X-Lang başlığıyla gider.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var I18N = window.I18N;
  var t = I18N.t;

  // ── Durum ────────────────────────────────────────────────────────────────

  var state = {
    user: null,
    config: {
      appName: "MeetApp",
      currency: "TRY",
      currencySymbol: "₺",
      paymentProvider: "demo",
      commissionRate: 0.1,
      ownerName: "MeetApp",
      demoCards: null,
    },
    // "*" = filtre yok. Kategori/şehir değerleri veritabanındaki hâlleriyle
    // taşınır, ekranda çevrilir.
    discover: { q: "", category: "*", city: "*" },
    filters: { categories: [], cities: [] },
  };

  var view = document.getElementById("view");
  var toastEl = document.getElementById("toast");
  var toastTimer = null;

  // ── Yardımcılar ──────────────────────────────────────────────────────────

  function h(value) {
    return String(value === undefined || value === null ? "" : value).replace(
      /[&<>"']/g,
      function (c) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c];
      },
    );
  }

  function money(minor, currency) {
    var value = (Number(minor) || 0) / 100;
    var options = {
      style: "currency",
      currency: currency || state.config.currency || "TRY",
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      // Dil ne olursa olsun ₺ gibi kısa simgeyi kullan; "TRY 150" yerine "₺150".
      currencyDisplay: "narrowSymbol",
    };
    try {
      return new Intl.NumberFormat(I18N.locale(), options).format(value);
    } catch (e) {
      try {
        delete options.currencyDisplay;
        return new Intl.NumberFormat(I18N.locale(), options).format(value);
      } catch (e2) {
        return value.toFixed(2) + " " + (state.config.currencySymbol || "");
      }
    }
  }

  function fmtDate(date, options) {
    try {
      return new Intl.DateTimeFormat(I18N.locale(), options).format(date);
    } catch (e) {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function dateShort(iso) {
    var d = new Date(iso);
    return (
      fmtDate(d, { weekday: "short", day: "numeric", month: "short" }) +
      " · " +
      timeOf(d)
    );
  }

  function dateLong(iso) {
    return fmtDate(new Date(iso), {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function timeOf(d) {
    return fmtDate(d, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function countdown(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return t("time.finished");
    var days = Math.floor(diff / 86400000);
    if (days >= 1) return t("time.inDays", { count: days });
    var hours = Math.floor(diff / 3600000);
    if (hours >= 1) return t("time.inHours", { count: hours });
    return t("time.inMinutes", { count: Math.max(Math.floor(diff / 60000), 1) });
  }

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      function () {
        toastEl.classList.remove("show");
      },
      kind === "long" ? 4200 : 2600,
    );
  }

  function api(path, options) {
    options = options || {};
    var headers = { "X-Lang": I18N.get() };
    if (options.body) headers["Content-Type"] = "application/json";

    return fetch("/api" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || t("common.genericError"));
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return data;
        });
    });
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function loading() {
    view.innerHTML =
      '<div class="event-grid">' +
      '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>' +
      "</div>";
  }

  function errorView(message) {
    view.innerHTML =
      '<div class="empty"><div class="e-ico">😕</div><h3>' +
      h(t("common.errorTitle")) +
      "</h3><p>" +
      h(message) +
      '</p><p style="margin-top:14px"><a class="btn btn-ghost" href="#/">' +
      h(t("common.backToDiscover")) +
      "</a></p></div>";
  }

  function initialsOf(name) {
    var parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(function (p) {
        return /^[\p{L}\p{N}]/u.test(p);
      });
    if (!parts.length) return "?";
    return parts
      .slice(0, 2)
      .map(function (p) {
        return p[0];
      })
      .join("")
      .toLocaleUpperCase(I18N.locale());
  }

  // ── Kabuk (üst çubuk + sekmeler + dil seçici) ────────────────────────────

  function tabs() {
    var list = [
      { href: "#/", ico: "🔍", label: t("tab.discover"), key: "discover" },
      { href: "#/my-events", ico: "🎟️", label: t("tab.myEvents"), key: "myevents" },
      { href: "#/create", ico: "➕", label: t("tab.create"), key: "create" },
      { href: "#/profile", ico: "👤", label: t("tab.profile"), key: "profile" },
    ];
    if (state.user && state.user.role === "owner") {
      list[3] = { href: "#/dashboard", ico: "📊", label: t("tab.panel"), key: "owner" };
    }
    return list;
  }

  function renderShell(activeKey) {
    var appbar = document.getElementById("appbar");
    var tabbar = document.getElementById("tabbar");
    var isAuthRoute = activeKey === "auth";

    appbar.hidden = isAuthRoute;
    tabbar.hidden = isAuthRoute;
    if (isAuthRoute) {
      renderLangMenu();
      return;
    }

    var list = tabs();
    var navLinks = list.concat(
      state.user && state.user.role === "owner"
        ? [{ href: "#/profile", ico: "👤", label: t("tab.profile"), key: "profile" }]
        : [],
    );

    document.getElementById("nav-desktop").innerHTML = navLinks
      .map(function (item) {
        return (
          '<a href="' +
          item.href +
          '" class="' +
          (item.key === activeKey ? "active" : "") +
          '">' +
          h(item.label) +
          "</a>"
        );
      })
      .join("");

    tabbar.innerHTML = list
      .map(function (item) {
        return (
          '<a href="' +
          item.href +
          '" class="' +
          (item.key === activeKey ? "active" : "") +
          '"><span class="ico">' +
          item.ico +
          "</span><span>" +
          h(item.label) +
          "</span></a>"
        );
      })
      .join("");

    var avatar = document.getElementById("appbar-avatar");
    avatar.setAttribute("aria-label", t("a11y.profile"));
    if (state.user) {
      avatar.setAttribute("href", "#/profile");
      avatar.innerHTML =
        '<span class="avatar">' + h(initialsOf(state.user.name)) + "</span>";
    } else {
      avatar.setAttribute("href", "#/login");
      avatar.innerHTML =
        '<span class="btn btn-primary btn-sm" style="min-height:34px">' +
        h(t("nav.signIn")) +
        "</span>";
    }

    document.getElementById("theme-toggle").setAttribute("title", t("a11y.theme"));
    document
      .getElementById("theme-toggle")
      .setAttribute("aria-label", t("a11y.theme"));

    renderLangMenu();
  }

  function renderLangMenu() {
    var btn = document.getElementById("lang-btn");
    var menu = document.getElementById("lang-menu");
    if (!btn || !menu) return;

    btn.textContent = I18N.get().toUpperCase();
    btn.setAttribute("title", t("a11y.language"));
    btn.setAttribute("aria-label", t("a11y.language"));

    menu.innerHTML = I18N.langs
      .map(function (lang) {
        return (
          '<button type="button" data-lang="' +
          lang.code +
          '" class="' +
          (lang.code === I18N.get() ? "active" : "") +
          '"><span>' +
          lang.flag +
          "</span><span>" +
          h(lang.label) +
          "</span></button>"
        );
      })
      .join("");

    menu.querySelectorAll("[data-lang]").forEach(function (item) {
      item.addEventListener("click", function () {
        closeLangMenu();
        changeLanguage(item.getAttribute("data-lang"));
      });
    });
  }

  function changeLanguage(code) {
    if (!I18N.set(code)) return;
    render();
    toast(t("toast.languageChanged"));
  }

  function closeLangMenu() {
    var menu = document.getElementById("lang-menu");
    if (menu) menu.hidden = true;
  }

  document.getElementById("lang-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    var menu = document.getElementById("lang-menu");
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", closeLangMenu);

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("meetapp.theme", next);
    } catch (e) {
      /* yoksay */
    }
    this.textContent = next === "dark" ? "☀️" : "🌙";
  });

  (function syncThemeIcon() {
    var current = document.documentElement.getAttribute("data-theme");
    document.getElementById("theme-toggle").textContent =
      current === "dark" ? "☀️" : "🌙";
  })();

  // ── Görünüm: Keşfet ──────────────────────────────────────────────────────

  function eventCardHtml(ev) {
    var pricePill =
      ev.priceMinor === 0
        ? '<span class="price-pill free">' + h(t("card.free")) + "</span>"
        : '<span class="price-pill">' + h(money(ev.priceMinor, ev.currency)) + "</span>";

    var spots = ev.isFull
      ? '<span class="badge danger">' + h(t("card.full")) + "</span>"
      : '<span class="badge">' +
        h(t("card.spotsLeft", { count: ev.spotsLeft })) +
        "</span>";

    var joined =
      ev.myRegistration && ev.myRegistration.status === "confirmed"
        ? '<span class="badge ok">' + h(t("card.joined")) + "</span>"
        : "";

    return (
      '<article class="event-card" data-href="#/event/' +
      ev.id +
      '"><div class="cover">' +
      h(ev.cover) +
      '</div><div class="event-body">' +
      '<div class="event-date">' +
      h(dateShort(ev.startsAt)) +
      '</div><h3 class="event-title">' +
      h(ev.title) +
      '</h3><div class="event-meta"><span>📍 ' +
      h(ev.venue || ev.city) +
      "</span><span>👥 " +
      ev.attendeeCount +
      "/" +
      ev.capacity +
      '</span></div><div class="event-foot">' +
      pricePill +
      spots +
      joined +
      "</div></div></article>"
    );
  }

  function viewDiscover() {
    renderShell("discover");
    document.body.classList.remove("has-action-bar");

    view.innerHTML =
      '<div class="page-head"><div>' +
      '<h1 class="page-title">' +
      h(t("discover.title")) +
      '</h1><p class="page-sub">' +
      h(t("discover.subtitle")) +
      "</p></div></div>" +
      '<div class="searchbar"><span class="search-ico">🔍</span>' +
      '<input id="q" type="search" placeholder="' +
      h(t("discover.searchPlaceholder")) +
      '" value="' +
      h(state.discover.q) +
      '" /></div>' +
      '<div id="chips-slot"></div><div id="list-slot"></div>';

    var input = document.getElementById("q");
    var typingTimer = null;
    input.addEventListener("input", function () {
      clearTimeout(typingTimer);
      var value = input.value;
      typingTimer = setTimeout(function () {
        state.discover.q = value;
        loadDiscoverList();
      }, 260);
    });

    loadDiscoverList();
  }

  function loadDiscoverList() {
    var listSlot = document.getElementById("list-slot");
    if (!listSlot) return;
    listSlot.innerHTML =
      '<div class="event-grid"><div class="skeleton"></div><div class="skeleton"></div></div>';

    var params = new URLSearchParams();
    if (state.discover.q) params.set("q", state.discover.q);
    if (state.discover.category !== "*")
      params.set("category", state.discover.category);
    if (state.discover.city !== "*") params.set("city", state.discover.city);

    api("/events?" + params.toString())
      .then(function (data) {
        state.filters = data.filters;
        renderChips();

        var slot = document.getElementById("list-slot");
        if (!slot) return;

        if (!data.events.length) {
          slot.innerHTML =
            '<div class="empty"><div class="e-ico">🗓️</div><h3>' +
            h(t("discover.emptyTitle")) +
            "</h3><p>" +
            h(t("discover.emptyBody")) +
            '</p><p style="margin-top:14px"><a class="btn btn-primary" href="#/create">' +
            h(t("discover.emptyCta")) +
            "</a></p></div>";
          return;
        }

        slot.innerHTML =
          '<div class="event-grid">' + data.events.map(eventCardHtml).join("") + "</div>";
      })
      .catch(function (err) {
        var slot = document.getElementById("list-slot");
        if (slot)
          slot.innerHTML = '<div class="alert alert-error">' + h(err.message) + "</div>";
      });
  }

  function renderChips() {
    var slot = document.getElementById("chips-slot");
    if (!slot) return;

    var categories = ["*"].concat(state.filters.categories || []);
    var cities = ["*"].concat(state.filters.cities || []);

    slot.innerHTML =
      '<div class="chips" id="cat-chips">' +
      categories
        .map(function (c) {
          var label = c === "*" ? t("filter.all") : I18N.category(c);
          return (
            '<button class="chip ' +
            (state.discover.category === c ? "active" : "") +
            '" data-cat="' +
            h(c) +
            '">' +
            h(label) +
            "</button>"
          );
        })
        .join("") +
      '</div><div class="chips" id="city-chips">' +
      cities
        .map(function (c) {
          var label = c === "*" ? t("filter.allCities") : "📍 " + c;
          return (
            '<button class="chip ' +
            (state.discover.city === c ? "active" : "") +
            '" data-city="' +
            h(c) +
            '">' +
            h(label) +
            "</button>"
          );
        })
        .join("") +
      "</div>";

    slot.querySelectorAll("[data-cat]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.discover.category = btn.getAttribute("data-cat");
        loadDiscoverList();
      });
    });
    slot.querySelectorAll("[data-city]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.discover.city = btn.getAttribute("data-city");
        loadDiscoverList();
      });
    });
  }

  // ── Görünüm: Etkinlik detayı ─────────────────────────────────────────────

  function viewEventDetail(id) {
    renderShell("");
    loading();

    api("/events/" + encodeURIComponent(id))
      .then(function (data) {
        var ev = data.event;
        var attendees = data.attendees;
        document.body.classList.add("has-action-bar");

        var joined = ev.myRegistration && ev.myRegistration.status === "confirmed";

        var attendeesHtml = attendees.length
          ? '<div class="avatar-stack">' +
            attendees
              .slice(0, 8)
              .map(function (a) {
                return (
                  '<span class="avatar sm" title="' +
                  h(a.name) +
                  '">' +
                  h(a.initials) +
                  "</span>"
                );
              })
              .join("") +
            '</div><span style="color:var(--muted);font-size:.9rem">' +
            (attendees.length > 8
              ? h(t("detail.andMore", { count: attendees.length - 8 }))
              : "") +
            h(t("detail.attendeeCount", { count: attendees.length })) +
            "</span>"
          : '<span style="color:var(--muted);font-size:.9rem">' +
            h(t("detail.noAttendees")) +
            "</span>";

        var capacityText =
          t("info.capacityValue", { count: ev.attendeeCount, capacity: ev.capacity }) +
          (ev.isFull
            ? t("info.capacityFull")
            : t("info.capacityLeft", { count: ev.spotsLeft }));

        var main =
          '<div class="card"><div class="detail-hero">' +
          '<div class="cover xl">' +
          h(ev.cover) +
          '</div><div><div class="event-date">' +
          h(countdown(ev.startsAt)) +
          '</div><h1 class="detail-title">' +
          h(ev.title) +
          '</h1><div class="event-foot">' +
          '<span class="badge info">' +
          h(I18N.category(ev.category)) +
          '</span><span class="badge">' +
          h(I18N.level(ev.level)) +
          "</span>" +
          (ev.status === "cancelled"
            ? '<span class="badge danger">' + h(t("detail.cancelledBadge")) + "</span>"
            : "") +
          '</div></div></div><div class="info-list">' +
          infoRow(
            "🗓️",
            t("info.date"),
            dateLong(ev.startsAt) +
              " · " +
              timeOf(new Date(ev.startsAt)) +
              (ev.endsAt ? " – " + timeOf(new Date(ev.endsAt)) : ""),
          ) +
          infoRow(
            "📍",
            t("info.place"),
            h((ev.venue ? ev.venue + " · " : "") + ev.city) +
              (ev.address
                ? "<br><span style='color:var(--muted);font-weight:500;font-size:.86rem'>" +
                  h(ev.address) +
                  "</span>"
                : ""),
            true,
          ) +
          infoRow("👥", t("info.capacity"), capacityText) +
          infoRow("🧑‍💼", t("info.host"), ev.organizer.name) +
          "</div></div>" +
          (ev.description
            ? '<div class="card"><h2 class="section-title" style="margin-top:0">' +
              h(t("detail.about")) +
              '</h2><p class="desc">' +
              h(ev.description) +
              "</p></div>"
            : "") +
          '<div class="card"><h2 class="section-title" style="margin-top:0">' +
          h(t("detail.attendees")) +
          '</h2><div class="attendee-row">' +
          attendeesHtml +
          "</div></div>" +
          (ev.isOrganizer
            ? '<div class="card"><h2 class="section-title" style="margin-top:0">' +
              h(t("detail.hostTools")) +
              '</h2><div style="display:flex;gap:10px;flex-wrap:wrap">' +
              '<a class="btn btn-ghost" href="#/event/' +
              ev.id +
              '/attendees">' +
              h(t("detail.attendeeListCta")) +
              "</a>" +
              (ev.status === "published"
                ? '<button class="btn btn-danger" id="btn-cancel-event">' +
                  h(t("detail.cancelEvent")) +
                  "</button>"
                : "") +
              "</div></div>"
            : "");

        view.innerHTML =
          '<a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:14px">' +
          h(t("detail.backToDiscover")) +
          '</a><div class="detail-layout"><div>' +
          main +
          '</div><div class="detail-side">' +
          actionBarHtml(ev, joined) +
          "</div></div>";

        wireDetailActions(ev);
      })
      .catch(function (err) {
        document.body.classList.remove("has-action-bar");
        errorView(err.message);
      });
  }

  function infoRow(ico, key, value, isHtml) {
    return (
      '<div class="info-row"><span class="ico">' +
      ico +
      '</span><div><div class="k">' +
      h(key) +
      '</div><div class="v">' +
      (isHtml ? value : h(value)) +
      "</div></div></div>"
    );
  }

  function actionBarHtml(ev, joined) {
    var priceLabel =
      ev.priceMinor === 0 ? t("card.free") : money(ev.priceMinor, ev.currency);
    var note = ev.priceMinor === 0 ? t("action.noFee") : t("action.perPerson");

    var button;
    if (ev.status === "cancelled") {
      button = '<button class="btn" disabled>' + h(t("action.eventCancelled")) + "</button>";
    } else if (ev.isPast) {
      button = '<button class="btn" disabled>' + h(t("action.eventPast")) + "</button>";
    } else if (ev.isOrganizer) {
      button =
        '<a class="btn btn-ghost" href="#/event/' +
        ev.id +
        '/attendees">' +
        h(t("action.seeAttendees")) +
        "</a>";
    } else if (joined) {
      button =
        '<a class="btn btn-primary" href="#/ticket/' +
        ev.myRegistration.id +
        '">' +
        h(t("action.showTicket")) +
        '</a><button class="btn btn-danger btn-sm" id="btn-leave" data-reg="' +
        ev.myRegistration.id +
        '">' +
        h(t("action.leave")) +
        "</button>";
    } else if (ev.isFull) {
      button = '<button class="btn" disabled>' + h(t("action.full")) + "</button>";
    } else {
      button =
        '<button class="btn btn-primary" id="btn-join">' +
        h(ev.priceMinor === 0 ? t("action.joinFree") : t("action.joinPay")) +
        "</button>";
    }

    return (
      '<div class="action-bar"><div class="price-block"><div class="amount">' +
      h(priceLabel) +
      '</div><div class="label">' +
      h(note) +
      "</div></div>" +
      button +
      "</div>"
    );
  }

  function wireDetailActions(ev) {
    var joinBtn = document.getElementById("btn-join");
    if (joinBtn) {
      joinBtn.addEventListener("click", function () {
        if (!state.user) {
          sessionStorage.setItem("meetapp.next", "#/event/" + ev.id);
          go("#/login");
          return;
        }
        joinBtn.disabled = true;
        joinBtn.textContent = t("action.joining");

        api("/events/" + ev.id + "/join", { method: "POST" })
          .then(function (res) {
            if (res.status === "confirmed") {
              toast(t("toast.joined"));
              go("#/my-events");
              return;
            }
            if (res.mode === "stripe" && res.checkoutUrl) {
              window.location.href = res.checkoutUrl;
              return;
            }
            go("#/checkout/" + res.paymentId);
          })
          .catch(function (err) {
            toast(err.message, "long");
            joinBtn.disabled = false;
            joinBtn.textContent =
              ev.priceMinor === 0 ? t("action.joinFree") : t("action.joinPay");
          });
      });
    }

    var leaveBtn = document.getElementById("btn-leave");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", function () {
        if (!confirm(t("confirm.leave"))) return;
        leaveBtn.disabled = true;
        api("/registrations/" + leaveBtn.getAttribute("data-reg") + "/cancel", {
          method: "POST",
        })
          .then(function (res) {
            toast(res.refunded ? t("toast.cancelledRefunded") : t("toast.cancelled"));
            render();
          })
          .catch(function (err) {
            toast(err.message, "long");
            leaveBtn.disabled = false;
          });
      });
    }

    var cancelEvent = document.getElementById("btn-cancel-event");
    if (cancelEvent) {
      cancelEvent.addEventListener("click", function () {
        if (!confirm(t("confirm.cancelEvent"))) return;
        api("/events/" + ev.id + "/cancel", { method: "POST" })
          .then(function () {
            toast(t("toast.eventCancelled"));
            render();
          })
          .catch(function (err) {
            toast(err.message, "long");
          });
      });
    }
  }

  // ── Görünüm: Ödeme ───────────────────────────────────────────────────────

  function viewCheckout(paymentId, query) {
    renderShell("");
    document.body.classList.remove("has-action-bar");
    loading();

    api("/payments/" + encodeURIComponent(paymentId))
      .then(function (data) {
        var sessionId = query.get("session_id");

        // Stripe'tan dönüş: ödeme sunucuda doğrulanır.
        if (data.payment.status === "pending" && sessionId) {
          view.innerHTML =
            '<div class="card"><div class="empty"><div class="e-ico">⏳</div><h3>' +
            h(t("checkout.verifying")) +
            "</h3><p>" +
            h(t("checkout.verifyingBody")) +
            "</p></div></div>";
          return api("/payments/" + paymentId + "/confirm", {
            method: "POST",
            body: { sessionId: sessionId },
          }).then(function () {
            go("#/ticket/" + data.registration.id);
            toast(t("toast.paid"));
          });
        }

        if (data.payment.status === "paid") {
          go("#/ticket/" + data.registration.id);
          return;
        }

        renderCheckoutForm(data);
      })
      .catch(function (err) {
        errorView(err.message);
      });
  }

  function renderCheckoutForm(data) {
    var ev = data.event;
    var p = data.payment;
    var cards = state.config.demoCards;

    view.innerHTML =
      '<a href="#/event/' +
      ev.id +
      '" class="btn btn-ghost btn-sm" style="margin-bottom:14px">' +
      h(t("checkout.back")) +
      '</a><div class="detail-layout"><div>' +
      '<div class="card"><h1 class="page-title" style="font-size:1.25rem;margin-bottom:14px">' +
      h(t("checkout.title")) +
      "</h1>" +
      (cards
        ? '<div class="alert alert-info">' +
          t("checkout.demoNotice", {
            success: h(cards.success),
            declined: h(cards.declined),
          }) +
          "</div>"
        : "") +
      '<form id="pay-form" novalidate>' +
      '<div id="pay-error" class="alert alert-error" hidden></div>' +
      '<div class="field"><label for="holder">' +
      h(t("checkout.holder")) +
      '</label><input id="holder" autocomplete="cc-name" placeholder="' +
      h(t("checkout.holderPlaceholder")) +
      '" required /></div>' +
      '<div class="field card-input-wrap"><label for="cardNumber">' +
      h(t("checkout.cardNumber")) +
      '</label><input id="cardNumber" inputmode="numeric" autocomplete="cc-number" ' +
      'placeholder="4242 4242 4242 4242" maxlength="23" required />' +
      '<span class="card-brands">VISA · MC</span></div>' +
      '<div class="field-row"><div class="field"><label for="expiry">' +
      h(t("checkout.expiry")) +
      '</label><input id="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="' +
      h(t("checkout.expiryPlaceholder")) +
      '" maxlength="5" required /></div>' +
      '<div class="field"><label for="cvc">' +
      h(t("checkout.cvc")) +
      '</label><input id="cvc" inputmode="numeric" autocomplete="cc-csc" ' +
      'placeholder="123" maxlength="4" required /></div></div>' +
      '<button type="submit" class="btn btn-primary btn-full" id="pay-btn">' +
      h(t("checkout.pay", { amount: money(p.amountMinor, p.currency) })) +
      '</button><div class="secure-note">' +
      h(t("checkout.secure", { owner: state.config.ownerName })) +
      "</div></form></div></div>" +
      '<div class="detail-side"><div class="card">' +
      '<h2 class="section-title" style="margin-top:0">' +
      h(t("checkout.summary")) +
      '</h2><div class="event-card" style="box-shadow:none;border:none;padding:0;cursor:default">' +
      '<div class="cover">' +
      h(ev.cover) +
      '</div><div class="event-body"><h3 class="event-title">' +
      h(ev.title) +
      '</h3><div class="event-meta"><span>' +
      h(dateShort(ev.startsAt)) +
      '</span></div><div class="event-meta"><span>📍 ' +
      h(ev.venue || ev.city) +
      '</span></div></div></div><div style="margin-top:14px">' +
      '<div class="summary-row"><span class="k">' +
      h(t("checkout.fee")) +
      '</span><span class="num">' +
      h(money(p.amountMinor, p.currency)) +
      '</span></div><div class="summary-row"><span class="k">' +
      h(t("checkout.serviceFee")) +
      '</span><span class="num">' +
      h(money(0, p.currency)) +
      '</span></div><div class="summary-row total"><span>' +
      h(t("checkout.total")) +
      '</span><span class="num">' +
      h(money(p.amountMinor, p.currency)) +
      "</span></div></div></div></div></div>";

    var cardInput = document.getElementById("cardNumber");
    cardInput.addEventListener("input", function () {
      var digits = cardInput.value.replace(/\D/g, "").slice(0, 19);
      cardInput.value = digits.replace(/(.{4})/g, "$1 ").trim();
    });

    var expiry = document.getElementById("expiry");
    expiry.addEventListener("input", function () {
      var digits = expiry.value.replace(/\D/g, "").slice(0, 4);
      expiry.value = digits.length > 2 ? digits.slice(0, 2) + "/" + digits.slice(2) : digits;
    });

    document.getElementById("cvc").addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 4);
    });

    document.getElementById("pay-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = document.getElementById("pay-btn");
      var errEl = document.getElementById("pay-error");
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = t("checkout.paying");

      api("/payments/" + p.id + "/confirm", {
        method: "POST",
        body: {
          holder: document.getElementById("holder").value,
          cardNumber: cardInput.value,
          expiry: expiry.value,
          cvc: document.getElementById("cvc").value,
        },
      })
        .then(function () {
          toast(t("toast.paid"));
          go("#/ticket/" + data.registration.id);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = t("checkout.pay", {
            amount: money(p.amountMinor, p.currency),
          });
        });
    });
  }

  // ── Görünüm: Bilet ───────────────────────────────────────────────────────

  function viewTicket(registrationId) {
    renderShell("myevents");
    document.body.classList.remove("has-action-bar");
    loading();

    api("/my/registrations")
      .then(function (data) {
        var reg = data.registrations.filter(function (r) {
          return String(r.id) === String(registrationId);
        })[0];

        if (!reg) return errorView(t("ticket.notFound"));
        if (reg.status !== "confirmed") {
          return errorView(t("ticket.notConfirmed", { status: reg.status }));
        }

        var ev = reg.event;
        view.innerHTML =
          '<a href="#/my-events" class="btn btn-ghost btn-sm" style="margin-bottom:14px">' +
          h(t("ticket.back")) +
          '</a><div style="max-width:460px;margin:0 auto"><div class="ticket">' +
          '<div style="font-size:40px">' +
          h(ev.cover) +
          '</div><div style="font-weight:800;font-size:1.2rem;margin:6px 0 2px">' +
          h(ev.title) +
          '</div><div style="opacity:.9;font-size:.9rem">' +
          h(dateShort(ev.startsAt)) +
          '</div><div class="t-divider"></div><div class="t-label">' +
          h(t("ticket.entryCode")) +
          '</div><div class="t-code">' +
          h(reg.ticketCode) +
          '</div><div style="opacity:.9;font-size:.85rem">' +
          h(reg.checkedInAt ? t("ticket.checkedIn") : t("ticket.showAtDoor")) +
          '</div></div><div class="card" style="margin-top:14px"><div class="info-list">' +
          infoRow("📍", t("info.place"), (ev.venue ? ev.venue + " · " : "") + ev.city) +
          infoRow(
            "🗓️",
            t("info.date"),
            dateLong(ev.startsAt) + " · " + timeOf(new Date(ev.startsAt)),
          ) +
          infoRow(
            "💳",
            t("ticket.paid"),
            reg.amountMinor ? money(reg.amountMinor, reg.currency) : t("card.free"),
          ) +
          '</div><div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
          '<a class="btn btn-ghost" href="#/event/' +
          ev.id +
          '">' +
          h(t("ticket.eventPage")) +
          "</a>" +
          (reg.isPast
            ? ""
            : '<button class="btn btn-danger" id="btn-leave" data-reg="' +
              reg.id +
              '">' +
              h(t("action.leave")) +
              "</button>") +
          "</div></div></div>";

        var leave = document.getElementById("btn-leave");
        if (leave) {
          leave.addEventListener("click", function () {
            if (!confirm(t("confirm.leave"))) return;
            leave.disabled = true;
            api("/registrations/" + reg.id + "/cancel", { method: "POST" })
              .then(function (res) {
                toast(res.refunded ? t("toast.cancelledRefunded") : t("toast.cancelled"));
                go("#/my-events");
              })
              .catch(function (err) {
                toast(err.message, "long");
                leave.disabled = false;
              });
          });
        }
      })
      .catch(function (err) {
        errorView(err.message);
      });
  }

  // ── Görünüm: Etkinliklerim ───────────────────────────────────────────────

  function viewMyEvents(query) {
    renderShell("myevents");
    document.body.classList.remove("has-action-bar");

    if (!state.user) return requireLogin("#/my-events");

    var tab = query.get("tab") === "hosting" ? "hosting" : "going";

    view.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">' +
      h(t("my.title")) +
      '</h1></div></div><div class="chips">' +
      '<button class="chip ' +
      (tab === "going" ? "active" : "") +
      '" data-tab="going">' +
      h(t("my.tabJoined")) +
      '</button><button class="chip ' +
      (tab === "hosting" ? "active" : "") +
      '" data-tab="hosting">' +
      h(t("my.tabHosted")) +
      '</button></div><div id="me-slot"><div class="skeleton"></div></div>';

    view.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        go("#/my-events?tab=" + btn.getAttribute("data-tab"));
      });
    });

    if (tab === "going") loadMyRegistrations();
    else loadMyOrganized();
  }

  function loadMyRegistrations() {
    api("/my/registrations").then(function (data) {
      var slot = document.getElementById("me-slot");
      if (!slot) return;

      var active = data.registrations.filter(function (r) {
        return r.status !== "cancelled" && !r.isPast;
      });
      var past = data.registrations.filter(function (r) {
        return r.isPast || r.status === "cancelled";
      });

      if (!data.registrations.length) {
        slot.innerHTML =
          '<div class="empty"><div class="e-ico">🎟️</div><h3>' +
          h(t("my.emptyJoinedTitle")) +
          "</h3><p>" +
          h(t("my.emptyJoinedBody")) +
          '</p><p style="margin-top:14px"><a class="btn btn-primary" href="#/">' +
          h(t("my.emptyJoinedCta")) +
          "</a></p></div>";
        return;
      }

      slot.innerHTML =
        (active.length
          ? '<h2 class="section-title">' +
            h(t("my.upcoming")) +
            '</h2><div class="event-grid">' +
            active.map(registrationCardHtml).join("") +
            "</div>"
          : "") +
        (past.length
          ? '<h2 class="section-title">' +
            h(t("my.pastAndCancelled")) +
            '</h2><div class="event-grid">' +
            past.map(registrationCardHtml).join("") +
            "</div>"
          : "");
    });
  }

  function registrationCardHtml(r) {
    var badge =
      r.status === "cancelled"
        ? '<span class="badge danger">' + h(t("status.cancelled")) + "</span>"
        : r.status === "pending"
          ? '<span class="badge warn">' + h(t("status.pendingPayment")) + "</span>"
          : r.checkedInAt
            ? '<span class="badge ok">' + h(t("status.checkedIn")) + "</span>"
            : '<span class="badge ok">' + h(t("status.confirmed")) + "</span>";

    var target = r.status === "confirmed" ? "#/ticket/" + r.id : "#/event/" + r.eventId;

    return (
      '<article class="event-card" data-href="' +
      target +
      '"><div class="cover">' +
      h(r.event.cover) +
      '</div><div class="event-body"><div class="event-date">' +
      h(dateShort(r.event.startsAt)) +
      '</div><h3 class="event-title">' +
      h(r.event.title) +
      '</h3><div class="event-meta"><span>📍 ' +
      h(r.event.venue || r.event.city) +
      '</span></div><div class="event-foot">' +
      badge +
      (r.ticketCode ? '<span class="price-pill">🎟️ ' + h(r.ticketCode) + "</span>" : "") +
      "</div></div></article>"
    );
  }

  function loadMyOrganized() {
    api("/my/events").then(function (data) {
      var slot = document.getElementById("me-slot");
      if (!slot) return;

      if (!data.events.length) {
        slot.innerHTML =
          '<div class="empty"><div class="e-ico">📣</div><h3>' +
          h(t("my.emptyHostedTitle")) +
          "</h3><p>" +
          h(t("my.emptyHostedBody")) +
          '</p><p style="margin-top:14px"><a class="btn btn-primary" href="#/create">' +
          h(t("my.emptyHostedCta")) +
          "</a></p></div>";
        return;
      }

      slot.innerHTML =
        '<div class="event-grid">' +
        data.events
          .map(function (ev) {
            return (
              '<article class="event-card" data-href="#/event/' +
              ev.id +
              '/attendees"><div class="cover">' +
              h(ev.cover) +
              '</div><div class="event-body"><div class="event-date">' +
              h(dateShort(ev.startsAt)) +
              '</div><h3 class="event-title">' +
              h(ev.title) +
              '</h3><div class="event-meta"><span>👥 ' +
              ev.attendeeCount +
              "/" +
              ev.capacity +
              "</span><span>💰 " +
              h(t("host.payable", { amount: money(ev.earnings.payable, ev.currency) })) +
              '</span></div><div class="event-foot">' +
              (ev.status === "cancelled"
                ? '<span class="badge danger">' + h(t("host.cancelled")) + "</span>"
                : ev.isPast
                  ? '<span class="badge">' + h(t("host.completed")) + "</span>"
                  : '<span class="badge ok">' + h(t("host.live")) + "</span>") +
              '<span class="badge info">' +
              h(t("host.payments", { count: ev.earnings.paid_count })) +
              "</span></div></div></article>"
            );
          })
          .join("") +
        "</div>";
    });
  }

  // ── Görünüm: Katılımcılar / giriş kontrolü ───────────────────────────────

  function viewAttendees(eventId) {
    renderShell("myevents");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/event/" + eventId + "/attendees");
    loading();

    Promise.all([api("/events/" + eventId), api("/events/" + eventId + "/attendees")])
      .then(function (results) {
        var ev = results[0].event;
        var attendees = results[1].attendees;

        var confirmed = attendees.filter(function (a) {
          return a.status === "confirmed";
        });

        view.innerHTML =
          '<a href="#/event/' +
          ev.id +
          '" class="btn btn-ghost btn-sm" style="margin-bottom:14px">' +
          h(t("att.back")) +
          '</a><div class="page-head"><div><h1 class="page-title">' +
          h(t("att.title")) +
          '</h1><p class="page-sub">' +
          h(
            t("att.subtitle", {
              title: ev.title,
              count: confirmed.length,
              capacity: ev.capacity,
            }),
          ) +
          '</p></div></div><div class="card">' +
          '<h2 class="section-title" style="margin-top:0">' +
          h(t("att.checkin")) +
          '</h2><div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<input id="checkin-code" placeholder="' +
          h(t("att.codePlaceholder")) +
          '" style="flex:1;min-width:180px;padding:12px 14px;border-radius:12px;' +
          'border:1px solid var(--border);background:var(--surface-2);font-size:16px;' +
          'text-transform:uppercase" />' +
          '<button class="btn btn-primary" id="checkin-btn">' +
          h(t("att.verify")) +
          '</button></div><div id="checkin-result" style="margin-top:12px"></div></div>' +
          '<div class="card"><h2 class="section-title" style="margin-top:0">' +
          h(t("att.list")) +
          "</h2>" +
          (attendees.length
            ? '<div class="table-wrap"><table class="data"><thead><tr><th>' +
              h(t("att.colName")) +
              "</th><th>" +
              h(t("att.colContact")) +
              "</th><th>" +
              h(t("att.colTicket")) +
              "</th><th>" +
              h(t("att.colPayment")) +
              "</th><th>" +
              h(t("att.colStatus")) +
              "</th></tr></thead><tbody>" +
              attendees
                .map(function (a) {
                  return (
                    "<tr><td><b>" +
                    h(a.name) +
                    '</b></td><td style="color:var(--muted)">' +
                    h(a.email) +
                    (a.phone ? "<br>" + h(a.phone) : "") +
                    '</td><td class="num">' +
                    h(a.ticketCode) +
                    '</td><td class="num">' +
                    h(money(a.amountMinor, ev.currency)) +
                    (a.paymentStatus
                      ? ' <span class="badge ' +
                        (a.paymentStatus === "paid"
                          ? "ok"
                          : a.paymentStatus === "refunded"
                            ? "warn"
                            : "") +
                        '">' +
                        h(paymentLabel(a.paymentStatus)) +
                        "</span>"
                      : "") +
                    "</td><td>" +
                    (a.status === "confirmed"
                      ? a.checkedInAt
                        ? '<span class="badge ok">' + h(t("att.arrived")) + "</span>"
                        : '<span class="badge info">' + h(t("att.waiting")) + "</span>"
                      : '<span class="badge">' + h(statusLabel(a.status)) + "</span>") +
                    "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">👥</div><h3>' +
              h(t("att.emptyTitle")) +
              "</h3></div>") +
          "</div>";

        document.getElementById("checkin-btn").addEventListener("click", function () {
          var code = document.getElementById("checkin-code").value.trim().toUpperCase();
          var out = document.getElementById("checkin-result");
          if (!code) return;

          api("/events/" + ev.id + "/checkin", { method: "POST", body: { code: code } })
            .then(function (res) {
              out.innerHTML =
                '<div class="alert alert-success">' +
                h(t("att.checkedInOk", { name: res.name })) +
                "</div>";
              document.getElementById("checkin-code").value = "";
              setTimeout(render, 900);
            })
            .catch(function (err) {
              out.innerHTML = '<div class="alert alert-error">' + h(err.message) + "</div>";
            });
        });
      })
      .catch(function (err) {
        errorView(err.message);
      });
  }

  function paymentLabel(status) {
    return t("pay." + status);
  }

  function statusLabel(status) {
    return { confirmed: t("status.confirmed"), cancelled: t("status.cancelled"), pending: t("status.pendingPayment") }[status] || status;
  }

  // ── Görünüm: Etkinlik oluştur ────────────────────────────────────────────

  function viewCreate() {
    renderShell("create");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/create");

    var covers = ["🏐", "⚽", "🏀", "🎾", "🧘", "🏃", "🌲", "💻", "🎨", "🎸", "☕", "🎉"];
    var now = new Date(Date.now() + 24 * 3600 * 1000);
    now.setMinutes(0, 0, 0);
    var defaultDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    view.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">' +
      h(t("create.title")) +
      '</h1><p class="page-sub">' +
      h(t("create.subtitle")) +
      '</p></div></div><div class="card"><form id="create-form" novalidate>' +
      '<div id="create-error" class="alert alert-error" hidden></div>' +
      '<div class="field"><label>' +
      h(t("create.cover")) +
      '</label><div class="chips" id="cover-chips">' +
      covers
        .map(function (c, i) {
          return (
            '<button type="button" class="chip ' +
            (i === 0 ? "active" : "") +
            '" data-cover="' +
            c +
            '" style="font-size:1.1rem">' +
            c +
            "</button>"
          );
        })
        .join("") +
      '</div></div><div class="field"><label for="c-title">' +
      h(t("create.eventTitle")) +
      '</label><input id="c-title" placeholder="' +
      h(t("create.titlePlaceholder")) +
      '" maxlength="120" required /></div>' +
      '<div class="field"><label for="c-desc">' +
      h(t("create.desc")) +
      '</label><textarea id="c-desc" placeholder="' +
      h(t("create.descPlaceholder")) +
      '"></textarea></div>' +
      '<div class="field-row"><div class="field"><label for="c-category">' +
      h(t("create.category")) +
      '</label><select id="c-category">' +
      I18N.categories
        .map(function (c) {
          return '<option value="' + h(c) + '">' + h(I18N.category(c)) + "</option>";
        })
        .join("") +
      '</select></div><div class="field"><label for="c-level">' +
      h(t("create.level")) +
      '</label><select id="c-level">' +
      I18N.levels
        .map(function (c) {
          return '<option value="' + h(c) + '">' + h(I18N.level(c)) + "</option>";
        })
        .join("") +
      "</select></div></div>" +
      '<div class="field-row"><div class="field"><label for="c-city">' +
      h(t("create.city")) +
      '</label><input id="c-city" placeholder="' +
      h(t("create.cityPlaceholder")) +
      '" value="' +
      h(state.user.city || "") +
      '" required /></div><div class="field"><label for="c-venue">' +
      h(t("create.venue")) +
      '</label><input id="c-venue" placeholder="' +
      h(t("create.venuePlaceholder")) +
      '" /></div></div>' +
      '<div class="field"><label for="c-address">' +
      h(t("create.address")) +
      '</label><input id="c-address" placeholder="' +
      h(t("create.addressPlaceholder")) +
      '" /></div>' +
      '<div class="field-row"><div class="field"><label for="c-start">' +
      h(t("create.start")) +
      '</label><input id="c-start" type="datetime-local" value="' +
      defaultDate +
      '" required /></div><div class="field"><label for="c-duration">' +
      h(t("create.duration")) +
      '</label><input id="c-duration" type="number" min="1" max="12" value="2" /></div></div>' +
      '<div class="field-row"><div class="field"><label for="c-capacity">' +
      h(t("create.capacity")) +
      '</label><input id="c-capacity" type="number" min="1" max="1000" value="12" required /></div>' +
      '<div class="field"><label for="c-price">' +
      h(t("create.price", { symbol: state.config.currencySymbol })) +
      '</label><input id="c-price" type="number" min="0" step="1" value="150" />' +
      '<div class="hint">' +
      h(t("create.priceHint")) +
      '</div></div></div>' +
      payoutNoticeHtml() +
      '<button type="submit" class="btn btn-primary btn-full" id="create-btn">' +
      h(t("create.submit")) +
      "</button></form></div>";

    var cover = "🏐";
    view.querySelectorAll("[data-cover]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        view.querySelectorAll("[data-cover]").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        cover = btn.getAttribute("data-cover");
      });
    });

    document.getElementById("create-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = document.getElementById("create-btn");
      var errEl = document.getElementById("create-error");
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = t("create.submitting");

      var startLocal = document.getElementById("c-start").value;

      api("/events", {
        method: "POST",
        body: {
          title: document.getElementById("c-title").value,
          description: document.getElementById("c-desc").value,
          category: document.getElementById("c-category").value,
          level: document.getElementById("c-level").value,
          cover: cover,
          city: document.getElementById("c-city").value,
          venue: document.getElementById("c-venue").value,
          address: document.getElementById("c-address").value,
          startsAt: startLocal ? new Date(startLocal).toISOString() : "",
          durationHours: Number(document.getElementById("c-duration").value),
          capacity: Number(document.getElementById("c-capacity").value),
          priceMinor: Math.round(
            Number(document.getElementById("c-price").value || 0) * 100,
          ),
        },
      })
        .then(function (res) {
          toast(t("toast.eventPublished"));
          go("#/event/" + res.event.id);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = t("create.submit");
        });
    });
  }

  /**
   * Etkinlik oluştururken paranın nereye gideceğini anlatan kutu.
   * Connect kapalıysa eski (elle aktarım) metni; açıksa hesabın durumuna göre
   * otomatik bölüşüm bilgisi ya da uyarı gösterilir.
   */
  function payoutNoticeHtml() {
    var percent = Math.round((1 - state.config.commissionRate) * 100);

    if (!state.config.connectEnabled) {
      return (
        '<div class="alert alert-info">' +
        h(t("create.payoutNote", { owner: state.config.ownerName, percent: percent })) +
        "</div>"
      );
    }
    if (state.user.payoutsReady) {
      return (
        '<div class="alert alert-info">' +
        h(t("create.payoutAuto", { percent: percent })) +
        "</div>"
      );
    }
    return (
      '<div class="alert alert-error">' +
      h(t("create.payoutWarning", { owner: state.config.ownerName })) +
      "</div>"
    );
  }

  // ── Görünüm: Profil ──────────────────────────────────────────────────────

  function viewProfile(query) {
    renderShell("profile");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/profile");

    var u = state.user;
    // Stripe kurulum ekranından dönüldüyse durumu tazele.
    var returningFromStripe =
      query && (query.get("payouts") === "done" || query.get("payouts") === "refresh");

    view.innerHTML =
      '<div class="card" style="text-align:center">' +
      '<div class="avatar lg" style="margin:0 auto 12px">' +
      h(initialsOf(u.name)) +
      '</div><h1 class="page-title" style="font-size:1.3rem">' +
      h(u.name) +
      '</h1><p class="page-sub">' +
      h(u.email) +
      (u.city ? " · " + h(u.city) : "") +
      "</p>" +
      (u.role === "owner"
        ? '<div style="margin-top:10px"><span class="badge ok">' +
          h(t("profile.ownerBadge")) +
          "</span></div>"
        : "") +
      "</div>" +
      (u.role === "owner"
        ? '<div class="card"><a class="btn btn-primary btn-full" href="#/dashboard">' +
          h(t("profile.openPanel")) +
          "</a></div>"
        : "") +
      '<div class="card"><h2 class="section-title" style="margin-top:0">' +
      h(t("payouts.title")) +
      '</h2><div id="payouts-slot"><div class="skeleton" style="height:70px"></div></div></div>' +
      '<div class="card"><h2 class="section-title" style="margin-top:0">' +
      h(t("profile.language")) +
      '</h2><div class="chips" id="lang-chips">' +
      I18N.langs
        .map(function (lang) {
          return (
            '<button class="chip ' +
            (lang.code === I18N.get() ? "active" : "") +
            '" data-set-lang="' +
            lang.code +
            '">' +
            lang.flag +
            " " +
            h(lang.label) +
            "</button>"
          );
        })
        .join("") +
      '</div><div class="hint" style="font-size:.78rem;color:var(--faint);margin-top:4px">' +
      h(t("profile.languageHint")) +
      "</div></div>" +
      '<div class="card"><h2 class="section-title" style="margin-top:0">' +
      h(t("profile.myInfo")) +
      '</h2><form id="profile-form">' +
      '<div id="profile-error" class="alert alert-error" hidden></div>' +
      '<div class="field"><label for="p-name">' +
      h(t("profile.name")) +
      '</label><input id="p-name" value="' +
      h(u.name) +
      '" /></div><div class="field-row">' +
      '<div class="field"><label for="p-city">' +
      h(t("profile.city")) +
      '</label><input id="p-city" value="' +
      h(u.city || "") +
      '" /></div><div class="field"><label for="p-phone">' +
      h(t("profile.phone")) +
      '</label><input id="p-phone" value="' +
      h(u.phone || "") +
      '" /></div></div><div class="field"><label for="p-bio">' +
      h(t("profile.bio")) +
      '</label><textarea id="p-bio">' +
      h(u.bio || "") +
      '</textarea></div><button class="btn btn-primary" id="p-save">' +
      h(t("profile.save")) +
      "</button></form></div>" +
      '<div class="card"><h2 class="section-title" style="margin-top:0">' +
      h(t("profile.payHistory")) +
      '</h2><div id="pay-history"><div class="skeleton" style="height:60px"></div></div></div>' +
      '<div class="card"><button class="btn btn-danger btn-full" id="logout">' +
      h(t("profile.logout")) +
      "</button></div>";

    view.querySelectorAll("[data-set-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        changeLanguage(btn.getAttribute("data-set-lang"));
      });
    });

    document.getElementById("profile-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = document.getElementById("p-save");
      var errEl = document.getElementById("profile-error");
      btn.disabled = true;
      errEl.hidden = true;

      api("/me", {
        method: "PATCH",
        body: {
          name: document.getElementById("p-name").value,
          city: document.getElementById("p-city").value,
          phone: document.getElementById("p-phone").value,
          bio: document.getElementById("p-bio").value,
        },
      })
        .then(function (res) {
          state.user = res.user;
          toast(t("toast.profileSaved"));
          renderShell("profile");
          btn.disabled = false;
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
        });
    });

    document.getElementById("logout").addEventListener("click", function () {
      api("/auth/logout", { method: "POST" }).then(function () {
        state.user = null;
        toast(t("toast.loggedOut"));
        go("#/");
      });
    });

    loadPayouts(returningFromStripe);

    api("/my/payments").then(function (data) {
      var slot = document.getElementById("pay-history");
      if (!slot) return;
      if (!data.payments.length) {
        slot.innerHTML =
          '<p style="color:var(--muted);font-size:.9rem">' +
          h(t("profile.noPayments")) +
          "</p>";
        return;
      }
      slot.innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>' +
        h(t("col.event")) +
        "</th><th>" +
        h(t("col.amount")) +
        "</th><th>" +
        h(t("col.status")) +
        "</th><th>" +
        h(t("col.date")) +
        "</th></tr></thead><tbody>" +
        data.payments
          .map(function (p) {
            return (
              "<tr><td>" +
              h(p.cover) +
              " " +
              h(p.eventTitle) +
              '</td><td class="num">' +
              h(money(p.amountMinor, p.currency)) +
              '</td><td><span class="badge ' +
              (p.status === "paid" ? "ok" : p.status === "refunded" ? "warn" : "") +
              '">' +
              h(paymentLabel(p.status)) +
              '</span></td><td class="num" style="color:var(--muted)">' +
              h(fmtDate(new Date(p.paidAt || p.createdAt), { dateStyle: "medium" })) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    });
  }

  /** Organizatörün Stripe hesabının durumunu yükler ve karta basar. */
  function loadPayouts(forceRefresh) {
    var request = forceRefresh
      ? api("/me/payouts/refresh", { method: "POST" }).then(function () {
          return api("/me/payouts");
        })
      : api("/me/payouts");

    request
      .then(function (info) {
        if (forceRefresh) {
          toast(t("payouts.refreshed"));
          // Sunucudaki hazırlık durumu değişmiş olabilir.
          api("/me").then(function (me) {
            if (me.user) state.user = me.user;
          });
        }
        renderPayouts(info);
      })
      .catch(function (err) {
        var slot = document.getElementById("payouts-slot");
        if (slot) slot.innerHTML = '<div class="alert alert-error">' + h(err.message) + "</div>";
      });
  }

  function renderPayouts(info) {
    var slot = document.getElementById("payouts-slot");
    if (!slot) return;

    if (!info.enabled) {
      slot.innerHTML =
        '<p style="color:var(--muted);font-size:.9rem">' +
        h(t("payouts.disabledNote")) +
        "</p>";
      return;
    }

    var badge, note, buttons;

    if (!info.connected) {
      badge = '<span class="badge">' + h(t("payouts.statusNone")) + "</span>";
      note = t("payouts.notReadyNote", { owner: state.config.ownerName });
      buttons =
        '<button class="btn btn-primary" data-payout="onboard">' +
        h(t("payouts.connect")) +
        "</button>";
    } else if (!info.ready) {
      badge = '<span class="badge warn">' + h(t("payouts.statusPending")) + "</span>";
      note = t("payouts.notReadyNote", { owner: state.config.ownerName });
      buttons =
        '<button class="btn btn-primary" data-payout="onboard">' +
        h(t("payouts.continue")) +
        '</button><button class="btn btn-ghost" data-payout="refresh">' +
        h(t("payouts.refresh")) +
        "</button>";
    } else {
      badge = '<span class="badge ok">' + h(t("payouts.statusActive")) + "</span>";
      note = t("payouts.readyNote", {
        percent: Math.round((1 - info.commissionRate) * 100),
      });
      buttons =
        (info.provider === "stripe"
          ? '<button class="btn btn-ghost" data-payout="dashboard">' +
            h(t("payouts.manage")) +
            "</button>"
          : "") +
        '<button class="btn btn-ghost" data-payout="refresh">' +
        h(t("payouts.refresh")) +
        "</button>";
    }

    slot.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      badge +
      "</div>" +
      '<p style="color:var(--muted);font-size:.92rem;margin-bottom:12px">' +
      h(info.connected ? note : t("payouts.intro") + " " + note) +
      "</p>" +
      (info.provider === "demo"
        ? '<div class="alert alert-info" style="font-size:.86rem">' +
          h(t("payouts.demoNote")) +
          "</div>"
        : "") +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      buttons +
      "</div>";

    slot.querySelectorAll("[data-payout]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-payout");
        var original = btn.textContent;
        btn.disabled = true;

        if (action === "refresh") {
          loadPayouts(true);
          return;
        }

        btn.textContent = t("payouts.opening");

        var call =
          action === "onboard"
            ? api("/me/payouts/onboard", { method: "POST" })
            : api("/me/payouts/dashboard");

        call
          .then(function (res) {
            if (res.url && !res.demo) {
              window.location.href = res.url;
              return;
            }
            // Demo modunda dışarı çıkmadan durumu tazeleriz.
            loadPayouts(true);
          })
          .catch(function (err) {
            toast(err.message, "long");
            btn.disabled = false;
            btn.textContent = original;
          });
      });
    });
  }

  // ── Görünüm: Uygulama sahibi paneli ──────────────────────────────────────

  function viewOwner() {
    renderShell("owner");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/dashboard");
    loading();

    Promise.all([api("/owner/summary"), api("/owner/payments")])
      .then(function (results) {
        var s = results[0];
        var payments = results[1].payments;
        var totals = s.totals;

        view.innerHTML =
          '<div class="page-head"><div><h1 class="page-title">' +
          h(t("owner.title")) +
          '</h1><p class="page-sub">' +
          h(
            t("owner.subtitle", {
              provider:
                s.provider === "stripe"
                  ? t("owner.providerStripe")
                  : t("owner.providerDemo"),
            }),
          ) +
          '</p></div></div><div class="stat-grid">' +
          statBox(t("owner.gross"), money(totals.gross, s.currency), true) +
          statBox(
            t("owner.commission", { percent: Math.round(s.commissionRate * 100) }),
            money(totals.commission, s.currency),
          ) +
          statBox(t("owner.autoPaid"), money(totals.organizer_auto, s.currency)) +
          statBox(t("owner.manualOwed"), money(totals.organizer_manual, s.currency)) +
          '</div><div class="stat-grid" style="margin-top:12px">' +
          statBox(t("owner.refunded"), money(totals.refunded, s.currency)) +
          statBox(t("owner.pendingCount"), String(totals.pending_count)) +
          statBox(t("owner.users"), String(s.counts.users)) +
          statBox(t("owner.liveEvents"), String(s.counts.events)) +
          '</div><div class="card" style="margin-top:14px">' +
          '<h2 class="section-title" style="margin-top:0">' +
          h(t("owner.byEvent")) +
          "</h2>" +
          (s.byEvent.length
            ? '<div class="table-wrap"><table class="data"><thead><tr><th>' +
              h(t("col.event")) +
              "</th><th>" +
              h(t("owner.colHost")) +
              "</th><th>" +
              h(t("owner.colPayments")) +
              "</th><th>" +
              h(t("owner.colGross")) +
              "</th><th>" +
              h(t("owner.colCommission")) +
              "</th><th>" +
              h(t("owner.colPayable")) +
              "</th></tr></thead><tbody>" +
              s.byEvent
                .map(function (e) {
                  return (
                    "<tr><td><b>" +
                    h(e.cover) +
                    " " +
                    h(e.title) +
                    '</b><br><span style="color:var(--muted);font-size:.8rem">' +
                    h(dateShort(e.starts_at)) +
                    " · " +
                    h(e.city) +
                    "</span></td><td>" +
                    h(e.organizer_name) +
                    '</td><td class="num">' +
                    e.paid_count +
                    '</td><td class="num">' +
                    h(money(e.gross, s.currency)) +
                    '</td><td class="num">' +
                    h(money(e.commission, s.currency)) +
                    '</td><td class="num">' +
                    h(money(e.payable, s.currency)) +
                    "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">💸</div><h3>' +
              h(t("owner.noPayments")) +
              "</h3></div>") +
          '</div><div class="card"><h2 class="section-title" style="margin-top:0">' +
          h(t("owner.recent")) +
          ' · ' + h(t("host.payments", { count: totals.paid_count })) +
          "</h2>" +
          (payments.length
            ? '<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>' +
              h(t("owner.colUser")) +
              "</th><th>" +
              h(t("col.event")) +
              "</th><th>" +
              h(t("col.amount")) +
              "</th><th>" +
              h(t("col.status")) +
              "</th><th>" +
              h(t("owner.colMethod")) +
              "</th><th>" +
              h(t("owner.colPayout")) +
              "</th></tr></thead><tbody>" +
              payments
                .map(function (p) {
                  return (
                    '<tr><td class="num">' +
                    p.id +
                    "</td><td><b>" +
                    h(p.userName) +
                    '</b><br><span style="color:var(--muted);font-size:.8rem">' +
                    h(p.userEmail) +
                    "</span></td><td>" +
                    h(p.cover) +
                    " " +
                    h(p.eventTitle) +
                    '</td><td class="num">' +
                    h(money(p.amountMinor, p.currency)) +
                    '</td><td><span class="badge ' +
                    (p.status === "paid"
                      ? "ok"
                      : p.status === "refunded"
                        ? "warn"
                        : p.status === "failed"
                          ? "danger"
                          : "") +
                    '">' +
                    h(paymentLabel(p.status)) +
                    '</span></td><td style="color:var(--muted)">' +
                    h(p.provider) +
                    (p.cardLast4 ? " ••" + h(p.cardLast4) : "") +
                    '</td><td><span class="badge ' +
                    (p.payoutMode === "connect" ? "ok" : "") +
                    '">' +
                    h(t("payout." + p.payoutMode)) +
                    "</span></td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">🧾</div><h3>' +
              h(t("owner.noRecords")) +
              "</h3></div>") +
          "</div>";
      })
      .catch(function (err) {
        errorView(err.message);
      });
  }

  function statBox(label, value, accent) {
    return (
      '<div class="stat' +
      (accent ? " accent" : "") +
      '"><div class="label">' +
      h(label) +
      '</div><div class="value">' +
      h(value) +
      "</div></div>"
    );
  }

  // ── Görünüm: Giriş / kayıt ───────────────────────────────────────────────

  function requireLogin(next) {
    sessionStorage.setItem("meetapp.next", next);
    go("#/login");
  }

  function viewAuth(mode) {
    renderShell("auth");
    document.body.classList.remove("has-action-bar");
    var isLogin = mode === "login";

    view.className = "auth-wrap";
    view.innerHTML =
      '<div class="auth-card"><div class="auth-hero"><div class="brand-mark">🎟️</div><h1>' +
      h(isLogin ? t("auth.welcomeBack") : t("auth.joinTitle")) +
      "</h1><p>" +
      h(isLogin ? t("auth.welcomeBackSub") : t("auth.joinSub")) +
      '</p></div><div class="card"><form id="auth-form" novalidate>' +
      '<div id="auth-error" class="alert alert-error" hidden></div>' +
      (isLogin
        ? ""
        : '<div class="field"><label for="a-name">' +
          h(t("auth.name")) +
          '</label><input id="a-name" autocomplete="name" placeholder="' +
          h(t("auth.namePlaceholder")) +
          '" required /></div>') +
      '<div class="field"><label for="a-email">' +
      h(t("auth.email")) +
      '</label><input id="a-email" type="email" autocomplete="email" ' +
      'placeholder="irfan@example.com" required /></div>' +
      '<div class="field"><label for="a-password">' +
      h(t("auth.password")) +
      '</label><input id="a-password" type="password" autocomplete="' +
      (isLogin ? "current-password" : "new-password") +
      '" placeholder="••••••••" required />' +
      (isLogin ? "" : '<div class="hint">' + h(t("auth.passwordHint")) + "</div>") +
      "</div>" +
      (isLogin
        ? ""
        : '<div class="field"><label for="a-city">' +
          h(t("auth.cityOptional")) +
          '</label><input id="a-city" placeholder="' +
          h(t("create.cityPlaceholder")) +
          '" /></div>') +
      '<button type="submit" class="btn btn-primary btn-full" id="auth-btn">' +
      h(isLogin ? t("auth.signIn") : t("auth.signUp")) +
      "</button></form>" +
      (isLogin
        ? '<div class="demo-box">' +
          h(t("auth.demoAccounts")) +
          "<br><b>irfan@example.com</b> / irfan1234 &nbsp;" +
          '<button data-fill="irfan@example.com|irfan1234">' +
          h(t("auth.fill")) +
          "</button><br><b>" +
          h(t("auth.ownerAccount")) +
          '</b> / owner1234 &nbsp;<button data-fill="owner@meetapp.app|owner1234">' +
          h(t("auth.fill")) +
          "</button></div>"
        : "") +
      '</div><div class="auth-switch">' +
      (isLogin
        ? h(t("auth.noAccount")) + ' <a href="#/signup">' + h(t("auth.register")) + "</a>"
        : h(t("auth.haveAccount")) + ' <a href="#/login">' + h(t("auth.signIn")) + "</a>") +
      ' · <a href="#/">' +
      h(t("auth.browse")) +
      "</a></div></div>";

    view.querySelectorAll("[data-fill]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-fill").split("|");
        document.getElementById("a-email").value = parts[0];
        document.getElementById("a-password").value = parts[1];
      });
    });

    document.getElementById("auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = document.getElementById("auth-btn");
      var errEl = document.getElementById("auth-error");
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = t("auth.wait");

      var body = {
        email: document.getElementById("a-email").value,
        password: document.getElementById("a-password").value,
      };
      if (!isLogin) {
        body.name = document.getElementById("a-name").value;
        body.city = document.getElementById("a-city").value;
      }

      api(isLogin ? "/auth/login" : "/auth/register", { method: "POST", body: body })
        .then(function (res) {
          state.user = res.user;
          var next = sessionStorage.getItem("meetapp.next") || "#/";
          sessionStorage.removeItem("meetapp.next");
          toast(t("toast.welcome", { name: res.user.name.split(" ")[0] }));
          go(next);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = isLogin ? t("auth.signIn") : t("auth.signUp");
        });
    });
  }

  // ── Yönlendirici ─────────────────────────────────────────────────────────

  function parseHash() {
    var raw = location.hash.replace(/^#/, "") || "/";
    var parts = raw.split("?");
    return {
      path: parts[0].replace(/\/+$/, "") || "/",
      query: new URLSearchParams(parts[1] || ""),
    };
  }

  function render() {
    var route = parseHash();
    var path = route.path;

    view.className = "container";
    document.title = state.config.appName + " — " + t("app.tagline");
    window.scrollTo(0, 0);

    var m;
    if (path === "/" || path === "/discover") return viewDiscover();
    if (path === "/login") return viewAuth("login");
    if (path === "/signup") return viewAuth("register");
    if ((m = path.match(/^\/event\/(\d+)\/attendees$/))) return viewAttendees(m[1]);
    if ((m = path.match(/^\/event\/(\d+)$/))) return viewEventDetail(m[1]);
    if ((m = path.match(/^\/checkout\/(\d+)$/))) return viewCheckout(m[1], route.query);
    if ((m = path.match(/^\/ticket\/(\d+)$/))) return viewTicket(m[1]);
    if (path === "/my-events") return viewMyEvents(route.query);
    if (path === "/create") return viewCreate();
    if (path === "/profile") return viewProfile(route.query);
    if (path === "/dashboard") return viewOwner();

    renderShell("");
    errorView(t("common.pageNotFound"));
  }

  // Kart tıklamalarını tek bir dinleyiciyle yakala.
  document.addEventListener("click", function (e) {
    var card = e.target.closest("[data-href]");
    if (card) location.hash = card.getAttribute("data-href");
  });

  window.addEventListener("hashchange", render);

  // ── Başlangıç ────────────────────────────────────────────────────────────

  Promise.all([
    api("/config").catch(function () {
      return null;
    }),
    api("/me").catch(function () {
      return { user: null };
    }),
  ])
    .then(function (results) {
      if (results[0]) state.config = Object.assign(state.config, results[0]);
      state.user = results[1].user;
      render();
    })
    .catch(function () {
      render();
    });
})();
