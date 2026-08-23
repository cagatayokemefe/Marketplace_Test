/* ════════════════════════════════════════════════════════════════════════════
   Buluş — istemci uygulaması
   Tek sayfalık, hash tabanlı yönlendirici. Derleme adımı yok; hem tarayıcıda
   hem de Capacitor ile paketlenmiş native kabukta aynı dosya çalışır.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ── Durum ────────────────────────────────────────────────────────────────

  var state = {
    user: null,
    config: {
      appName: "Buluş",
      currency: "TRY",
      currencySymbol: "₺",
      paymentProvider: "demo",
      commissionRate: 0.1,
      ownerName: "Buluş",
      demoCards: null,
    },
    discover: { q: "", category: "Tümü", city: "Tümü" },
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
    try {
      return new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: currency || state.config.currency || "TRY",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      }).format(value);
    } catch (e) {
      return value.toFixed(2) + " " + (state.config.currencySymbol || "");
    }
  }

  var DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  var MONTHS = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];

  function dateShort(iso) {
    var d = new Date(iso);
    return (
      DAYS[d.getDay()] +
      ", " +
      d.getDate() +
      " " +
      MONTHS[d.getMonth()] +
      " · " +
      timeOf(d)
    );
  }

  function dateLong(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function timeOf(d) {
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function countdown(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return "Tamamlandı";
    var days = Math.floor(diff / 86400000);
    if (days >= 1) return days + " gün sonra";
    var hours = Math.floor(diff / 3600000);
    if (hours >= 1) return hours + " saat sonra";
    return Math.max(Math.floor(diff / 60000), 1) + " dk sonra";
  }

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, kind === "long" ? 4200 : 2600);
  }

  function api(path, options) {
    options = options || {};
    return fetch("/api" + path, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
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
            var err = new Error(data.error || "Bir hata oluştu.");
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
      '<div class="empty"><div class="e-ico">😕</div><h3>Olmadı</h3><p>' +
      h(message) +
      '</p><p style="margin-top:14px"><a class="btn btn-ghost" href="#/">Keşfet\'e dön</a></p></div>';
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
      .toLocaleUpperCase("tr-TR");
  }

  // ── Kabuk (üst çubuk + sekmeler) ─────────────────────────────────────────

  var TABS = [
    { href: "#/", ico: "🔍", label: "Keşfet" },
    { href: "#/etkinliklerim", ico: "🎟️", label: "Etkinliklerim" },
    { href: "#/olustur", ico: "➕", label: "Oluştur" },
    { href: "#/profil", ico: "👤", label: "Profil" },
  ];

  function renderShell(activeKey) {
    var appbar = document.getElementById("appbar");
    var tabbar = document.getElementById("tabbar");
    var isAuthRoute = activeKey === "auth";

    appbar.hidden = isAuthRoute;
    tabbar.hidden = isAuthRoute;
    if (isAuthRoute) return;

    var tabs = TABS.slice();
    if (state.user && state.user.role === "owner") {
      tabs[3] = { href: "#/panel", ico: "📊", label: "Panel" };
    }

    var navLinks = tabs.concat(
      state.user && state.user.role === "owner"
        ? [{ href: "#/profil", ico: "👤", label: "Profil" }]
        : [],
    );

    document.getElementById("nav-desktop").innerHTML = navLinks
      .map(function (t) {
        var active = t.href === "#/" ? activeKey === "discover" : activeKey === keyOf(t.href);
        return (
          '<a href="' + t.href + '" class="' + (active ? "active" : "") + '">' +
          h(t.label) +
          "</a>"
        );
      })
      .join("");

    tabbar.innerHTML = tabs
      .map(function (t) {
        var active = t.href === "#/" ? activeKey === "discover" : activeKey === keyOf(t.href);
        return (
          '<a href="' + t.href + '" class="' + (active ? "active" : "") + '">' +
          '<span class="ico">' + t.ico + "</span><span>" + h(t.label) + "</span></a>"
        );
      })
      .join("");

    var avatar = document.getElementById("appbar-avatar");
    if (state.user) {
      avatar.setAttribute("href", "#/profil");
      avatar.innerHTML =
        '<span class="avatar">' + h(initialsOf(state.user.name)) + "</span>";
    } else {
      avatar.innerHTML =
        '<span class="btn btn-primary btn-sm" style="min-height:34px">Giriş yap</span>';
      avatar.setAttribute("href", "#/giris");
    }
  }

  function keyOf(hash) {
    if (hash === "#/") return "discover";
    if (hash.indexOf("#/etkinliklerim") === 0) return "myevents";
    if (hash.indexOf("#/olustur") === 0) return "create";
    if (hash.indexOf("#/profil") === 0) return "profile";
    if (hash.indexOf("#/panel") === 0) return "owner";
    return "";
  }

  document.getElementById("theme-toggle").addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("bulus.theme", next);
    this.textContent = next === "dark" ? "☀️" : "🌙";
  });

  (function syncThemeIcon() {
    var current = document.documentElement.getAttribute("data-theme");
    document.getElementById("theme-toggle").textContent =
      current === "dark" ? "☀️" : "🌙";
  })();

  // ── Görünüm: Keşfet ──────────────────────────────────────────────────────

  function eventCardHtml(ev) {
    var pricePill = ev.priceMinor === 0
      ? '<span class="price-pill free">Ücretsiz</span>'
      : '<span class="price-pill">' + h(money(ev.priceMinor, ev.currency)) + "</span>";

    var spots =
      ev.isFull
        ? '<span class="badge danger">Kontenjan dolu</span>'
        : '<span class="badge">' + ev.spotsLeft + " kişilik yer</span>";

    var joined =
      ev.myRegistration && ev.myRegistration.status === "confirmed"
        ? '<span class="badge ok">Katılıyorsun</span>'
        : "";

    return (
      '<article class="event-card" data-href="#/etkinlik/' + ev.id + '">' +
      '<div class="cover">' + h(ev.cover) + "</div>" +
      '<div class="event-body">' +
      '<div class="event-date">' + h(dateShort(ev.startsAt)) + "</div>" +
      '<h3 class="event-title">' + h(ev.title) + "</h3>" +
      '<div class="event-meta"><span>📍 ' + h(ev.venue || ev.city) + "</span>" +
      "<span>👥 " + ev.attendeeCount + "/" + ev.capacity + "</span></div>" +
      '<div class="event-foot">' + pricePill + spots + joined + "</div>" +
      "</div></article>"
    );
  }

  function viewDiscover() {
    renderShell("discover");
    document.body.classList.remove("has-action-bar");

    var params = new URLSearchParams();
    if (state.discover.q) params.set("q", state.discover.q);
    if (state.discover.category !== "Tümü")
      params.set("category", state.discover.category);
    if (state.discover.city !== "Tümü") params.set("city", state.discover.city);

    var head =
      '<div class="page-head"><div>' +
      '<h1 class="page-title">Yakınında neler var?</h1>' +
      '<p class="page-sub">Etkinliği seç, yerini ödemeyle garantile.</p>' +
      "</div></div>" +
      '<div class="searchbar"><span class="search-ico">🔍</span>' +
      '<input id="q" type="search" placeholder="Voleybol, yoga, İstanbul…" value="' +
      h(state.discover.q) +
      '" /></div>';

    view.innerHTML = head + '<div id="chips-slot"></div><div id="list-slot"></div>';

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
    listSlot.innerHTML = '<div class="event-grid"><div class="skeleton"></div><div class="skeleton"></div></div>';

    var params = new URLSearchParams();
    if (state.discover.q) params.set("q", state.discover.q);
    if (state.discover.category !== "Tümü")
      params.set("category", state.discover.category);
    if (state.discover.city !== "Tümü") params.set("city", state.discover.city);

    api("/events?" + params.toString())
      .then(function (data) {
        state.filters = data.filters;
        renderChips();

        var slot = document.getElementById("list-slot");
        if (!slot) return;

        if (!data.events.length) {
          slot.innerHTML =
            '<div class="empty"><div class="e-ico">🗓️</div>' +
            "<h3>Bu filtreyle etkinlik yok</h3>" +
            "<p>Aramayı temizle ya da kendi etkinliğini oluştur.</p>" +
            '<p style="margin-top:14px"><a class="btn btn-primary" href="#/olustur">Etkinlik oluştur</a></p></div>';
          return;
        }

        slot.innerHTML =
          '<div class="event-grid">' +
          data.events.map(eventCardHtml).join("") +
          "</div>";
      })
      .catch(function (err) {
        var slot = document.getElementById("list-slot");
        if (slot) slot.innerHTML = '<div class="alert alert-error">' + h(err.message) + "</div>";
      });
  }

  function renderChips() {
    var slot = document.getElementById("chips-slot");
    if (!slot) return;

    var categories = ["Tümü"].concat(state.filters.categories || []);
    var cities = ["Tümü"].concat(state.filters.cities || []);

    slot.innerHTML =
      '<div class="chips" id="cat-chips">' +
      categories
        .map(function (c) {
          return (
            '<button class="chip ' +
            (state.discover.category === c ? "active" : "") +
            '" data-cat="' + h(c) + '">' + h(c) + "</button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="chips" id="city-chips">' +
      cities
        .map(function (c) {
          return (
            '<button class="chip ' +
            (state.discover.city === c ? "active" : "") +
            '" data-city="' + h(c) + '">' + (c === "Tümü" ? "Tüm şehirler" : "📍 " + h(c)) + "</button>"
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
                return '<span class="avatar sm" title="' + h(a.name) + '">' + h(a.initials) + "</span>";
              })
              .join("") +
            "</div>" +
            '<span style="color:var(--muted);font-size:.9rem">' +
            (attendees.length > 8 ? "+" + (attendees.length - 8) + " kişi daha · " : "") +
            "toplam " + attendees.length + " katılımcı</span>"
          : '<span style="color:var(--muted);font-size:.9rem">Henüz kimse katılmadı — ilk sen ol!</span>';

        var main =
          '<div class="card">' +
          '<div class="detail-hero">' +
          '<div class="cover xl">' + h(ev.cover) + "</div>" +
          "<div>" +
          '<div class="event-date">' + h(countdown(ev.startsAt)) + "</div>" +
          '<h1 class="detail-title">' + h(ev.title) + "</h1>" +
          '<div class="event-foot">' +
          '<span class="badge info">' + h(ev.category) + "</span>" +
          '<span class="badge">' + h(ev.level) + "</span>" +
          (ev.status === "cancelled" ? '<span class="badge danger">İptal edildi</span>' : "") +
          "</div></div></div>" +

          '<div class="info-list">' +
          infoRow("🗓️", "Tarih", dateLong(ev.startsAt) + " · " + timeOf(new Date(ev.startsAt)) +
            (ev.endsAt ? " – " + timeOf(new Date(ev.endsAt)) : "")) +
          infoRow("📍", "Yer", (ev.venue ? ev.venue + " · " : "") + ev.city +
            (ev.address ? "<br><span style='color:var(--muted);font-weight:500;font-size:.86rem'>" + h(ev.address) + "</span>" : ""), true) +
          infoRow("👥", "Kontenjan", ev.attendeeCount + " / " + ev.capacity + " kişi" +
            (ev.isFull ? " · dolu" : " · " + ev.spotsLeft + " yer kaldı")) +
          infoRow("🧑‍💼", "Organizatör", ev.organizer.name) +
          "</div></div>" +

          (ev.description
            ? '<div class="card"><h2 class="section-title" style="margin-top:0">Etkinlik hakkında</h2>' +
              '<p class="desc">' + h(ev.description) + "</p></div>"
            : "") +

          '<div class="card"><h2 class="section-title" style="margin-top:0">Katılanlar</h2>' +
          '<div class="attendee-row">' + attendeesHtml + "</div></div>" +

          (ev.isOrganizer
            ? '<div class="card"><h2 class="section-title" style="margin-top:0">Organizatör araçları</h2>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
              '<a class="btn btn-ghost" href="#/etkinlik/' + ev.id + '/katilimcilar">Katılımcı listesi &amp; giriş kontrolü</a>' +
              (ev.status === "published"
                ? '<button class="btn btn-danger" id="btn-cancel-event">Etkinliği iptal et</button>'
                : "") +
              "</div></div>"
            : "");

        var side = actionBarHtml(ev, joined);

        view.innerHTML =
          '<a href="#/" class="btn btn-ghost btn-sm" style="margin-bottom:14px">← Keşfet</a>' +
          '<div class="detail-layout"><div>' + main + '</div><div class="detail-side">' + side + "</div></div>";

        wireDetailActions(ev);
      })
      .catch(function (err) {
        document.body.classList.remove("has-action-bar");
        errorView(err.message);
      });
  }

  function infoRow(ico, key, value, isHtml) {
    return (
      '<div class="info-row"><span class="ico">' + ico + "</span><div>" +
      '<div class="k">' + h(key) + "</div>" +
      '<div class="v">' + (isHtml ? value : h(value)) + "</div>" +
      "</div></div>"
    );
  }

  function actionBarHtml(ev, joined) {
    var priceLabel = ev.priceMinor === 0 ? "Ücretsiz" : money(ev.priceMinor, ev.currency);
    var note = ev.priceMinor === 0 ? "katılım ücreti yok" : "kişi başı";

    var button;
    if (ev.status === "cancelled") {
      button = '<button class="btn" disabled>Etkinlik iptal edildi</button>';
    } else if (ev.isPast) {
      button = '<button class="btn" disabled>Bu etkinlik geçti</button>';
    } else if (ev.isOrganizer) {
      button = '<a class="btn btn-ghost" href="#/etkinlik/' + ev.id + '/katilimcilar">Katılımcıları gör</a>';
    } else if (joined) {
      button =
        '<a class="btn btn-primary" href="#/bilet/' + ev.myRegistration.id + '">Biletimi göster</a>' +
        '<button class="btn btn-danger btn-sm" id="btn-leave" data-reg="' + ev.myRegistration.id + '">Katılımı iptal et</button>';
    } else if (ev.isFull) {
      button = '<button class="btn" disabled>Kontenjan dolu</button>';
    } else {
      button =
        '<button class="btn btn-primary" id="btn-join">' +
        (ev.priceMinor === 0 ? "Ücretsiz katıl" : "Katıl ve öde") +
        "</button>";
    }

    return (
      '<div class="action-bar">' +
      '<div class="price-block"><div class="amount">' + h(priceLabel) + "</div>" +
      '<div class="label">' + h(note) + "</div></div>" +
      button +
      "</div>"
    );
  }

  function wireDetailActions(ev) {
    var joinBtn = document.getElementById("btn-join");
    if (joinBtn) {
      joinBtn.addEventListener("click", function () {
        if (!state.user) {
          sessionStorage.setItem("bulus.next", "#/etkinlik/" + ev.id);
          go("#/giris");
          return;
        }
        joinBtn.disabled = true;
        joinBtn.textContent = "Yer ayrılıyor…";

        api("/events/" + ev.id + "/join", { method: "POST" })
          .then(function (res) {
            if (res.status === "confirmed") {
              toast("Kaydın tamam! Görüşmek üzere 🎉");
              go("#/etkinliklerim");
              return;
            }
            if (res.mode === "stripe" && res.checkoutUrl) {
              window.location.href = res.checkoutUrl;
              return;
            }
            go("#/odeme/" + res.paymentId);
          })
          .catch(function (err) {
            toast(err.message, "long");
            joinBtn.disabled = false;
            joinBtn.textContent = ev.priceMinor === 0 ? "Ücretsiz katıl" : "Katıl ve öde";
          });
      });
    }

    var leaveBtn = document.getElementById("btn-leave");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", function () {
        if (!confirm("Katılımını iptal etmek istediğine emin misin?")) return;
        leaveBtn.disabled = true;
        api("/registrations/" + leaveBtn.getAttribute("data-reg") + "/cancel", {
          method: "POST",
        })
          .then(function (res) {
            toast(res.refunded ? "İptal edildi, ücret iade edildi." : "Katılımın iptal edildi.");
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
        if (!confirm("Etkinliği iptal etmek üzeresin. Devam edilsin mi?")) return;
        api("/events/" + ev.id + "/cancel", { method: "POST" })
          .then(function () {
            toast("Etkinlik iptal edildi.");
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
            '<div class="card"><div class="empty"><div class="e-ico">⏳</div>' +
            "<h3>Ödemen doğrulanıyor…</h3><p>Bu sayfadan ayrılma.</p></div></div>";
          return api("/payments/" + paymentId + "/confirm", {
            method: "POST",
            body: { sessionId: sessionId },
          }).then(function (res) {
            go("#/bilet/" + data.registration.id);
            toast("Ödeme alındı, biletin hazır 🎟️");
          });
        }

        if (data.payment.status === "paid") {
          go("#/bilet/" + data.registration.id);
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
    var demo = state.config.paymentProvider === "demo";

    view.innerHTML =
      '<a href="#/etkinlik/' + ev.id + '" class="btn btn-ghost btn-sm" style="margin-bottom:14px">← Vazgeç</a>' +
      '<div class="detail-layout"><div>' +
      '<div class="card"><h1 class="page-title" style="font-size:1.25rem;margin-bottom:14px">Ödeme</h1>' +
      (demo
        ? '<div class="alert alert-info">Demo modu: gerçek para çekilmez. Test kartı ' +
          "<b>4242 4242 4242 4242</b>, reddedilen kart <b>4000 0000 0000 0002</b>.</div>"
        : "") +
      '<form id="pay-form" novalidate>' +
      '<div id="pay-error" class="alert alert-error" hidden></div>' +
      '<div class="field"><label for="holder">Kart üzerindeki isim</label>' +
      '<input id="holder" autocomplete="cc-name" placeholder="İrfan Yılmaz" required /></div>' +
      '<div class="field card-input-wrap"><label for="cardNumber">Kart numarası</label>' +
      '<input id="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23" required />' +
      '<span class="card-brands">VISA · MC</span></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="expiry">Son kullanma</label>' +
      '<input id="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="12/29" maxlength="5" required /></div>' +
      '<div class="field"><label for="cvc">CVC</label>' +
      '<input id="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" required /></div>' +
      "</div>" +
      '<button type="submit" class="btn btn-primary btn-full" id="pay-btn">' +
      h(money(p.amountMinor, p.currency)) + " öde</button>" +
      '<div class="secure-note">🔒 Ödeme ' + h(state.config.ownerName) + " hesabına aktarılır.</div>" +
      "</form></div></div>" +

      '<div class="detail-side"><div class="card">' +
      '<h2 class="section-title" style="margin-top:0">Özet</h2>' +
      '<div class="event-card" style="box-shadow:none;border:none;padding:0;cursor:default">' +
      '<div class="cover">' + h(ev.cover) + "</div>" +
      '<div class="event-body"><h3 class="event-title">' + h(ev.title) + "</h3>" +
      '<div class="event-meta"><span>' + h(dateShort(ev.startsAt)) + "</span></div>" +
      '<div class="event-meta"><span>📍 ' + h(ev.venue || ev.city) + "</span></div>" +
      "</div></div>" +
      '<div style="margin-top:14px">' +
      '<div class="summary-row"><span class="k">Katılım ücreti</span><span class="num">' +
      h(money(p.amountMinor, p.currency)) + "</span></div>" +
      '<div class="summary-row"><span class="k">Hizmet bedeli</span><span class="num">' +
      h(money(0, p.currency)) + "</span></div>" +
      '<div class="summary-row total"><span>Toplam</span><span class="num">' +
      h(money(p.amountMinor, p.currency)) + "</span></div>" +
      "</div></div></div></div>";

    // Kart alanı biçimlendirme
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
      btn.textContent = "Ödeme alınıyor…";

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
          toast("Ödeme alındı, biletin hazır 🎟️");
          go("#/bilet/" + data.registration.id);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = money(p.amountMinor, p.currency) + " öde";
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

        if (!reg) return errorView("Bilet bulunamadı.");
        if (reg.status !== "confirmed") {
          return errorView("Bu kayıt henüz onaylanmadı (" + reg.status + ").");
        }

        var ev = reg.event;
        view.innerHTML =
          '<a href="#/etkinliklerim" class="btn btn-ghost btn-sm" style="margin-bottom:14px">← Etkinliklerim</a>' +
          '<div style="max-width:460px;margin:0 auto">' +
          '<div class="ticket">' +
          '<div style="font-size:40px">' + h(ev.cover) + "</div>" +
          '<div style="font-weight:800;font-size:1.2rem;margin:6px 0 2px">' + h(ev.title) + "</div>" +
          '<div style="opacity:.9;font-size:.9rem">' + h(dateShort(ev.startsAt)) + "</div>" +
          '<div class="t-divider"></div>' +
          '<div class="t-label">Giriş kodu</div>' +
          '<div class="t-code">' + h(reg.ticketCode) + "</div>" +
          '<div style="opacity:.9;font-size:.85rem">' +
          (reg.checkedInAt ? "✓ Giriş yapıldı" : "Girişte organizatöre göster") +
          "</div></div>" +

          '<div class="card" style="margin-top:14px">' +
          '<div class="info-list">' +
          infoRow("📍", "Yer", (ev.venue ? ev.venue + " · " : "") + ev.city) +
          infoRow("🗓️", "Tarih", dateLong(ev.startsAt) + " · " + timeOf(new Date(ev.startsAt))) +
          infoRow("💳", "Ödenen", reg.amountMinor ? money(reg.amountMinor, reg.currency) : "Ücretsiz") +
          "</div>" +
          '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' +
          '<a class="btn btn-ghost" href="#/etkinlik/' + ev.id + '">Etkinlik sayfası</a>' +
          (reg.isPast
            ? ""
            : '<button class="btn btn-danger" id="btn-leave" data-reg="' + reg.id + '">Katılımı iptal et</button>') +
          "</div></div></div>";

        var leave = document.getElementById("btn-leave");
        if (leave) {
          leave.addEventListener("click", function () {
            if (!confirm("Katılımını iptal etmek istediğine emin misin?")) return;
            leave.disabled = true;
            api("/registrations/" + reg.id + "/cancel", { method: "POST" })
              .then(function (res) {
                toast(res.refunded ? "İptal edildi, ücret iade edildi." : "Katılımın iptal edildi.");
                go("#/etkinliklerim");
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

    if (!state.user) return requireLogin("#/etkinliklerim");

    var tab = query.get("sekme") === "organizator" ? "organizator" : "katilim";

    view.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Etkinliklerim</h1></div></div>' +
      '<div class="chips">' +
      '<button class="chip ' + (tab === "katilim" ? "active" : "") + '" data-tab="katilim">Katıldıklarım</button>' +
      '<button class="chip ' + (tab === "organizator" ? "active" : "") + '" data-tab="organizator">Oluşturduklarım</button>' +
      "</div><div id=\"me-slot\"><div class='skeleton'></div></div>";

    view.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        go("#/etkinliklerim?sekme=" + btn.getAttribute("data-tab"));
      });
    });

    if (tab === "katilim") loadMyRegistrations();
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
          '<div class="empty"><div class="e-ico">🎟️</div><h3>Henüz bir etkinliğe katılmadın</h3>' +
          "<p>Keşfet sekmesinden ilgini çeken bir şey bul.</p>" +
          '<p style="margin-top:14px"><a class="btn btn-primary" href="#/">Etkinlikleri keşfet</a></p></div>';
        return;
      }

      slot.innerHTML =
        (active.length
          ? '<h2 class="section-title">Yaklaşanlar</h2><div class="event-grid">' +
            active.map(registrationCardHtml).join("") + "</div>"
          : "") +
        (past.length
          ? '<h2 class="section-title">Geçmiş &amp; iptaller</h2><div class="event-grid">' +
            past.map(registrationCardHtml).join("") + "</div>"
          : "");
    });
  }

  function registrationCardHtml(r) {
    var badge =
      r.status === "cancelled"
        ? '<span class="badge danger">İptal edildi</span>'
        : r.status === "pending"
          ? '<span class="badge warn">Ödeme bekliyor</span>'
          : r.checkedInAt
            ? '<span class="badge ok">Giriş yapıldı</span>'
            : '<span class="badge ok">Onaylı</span>';

    var target =
      r.status === "confirmed" ? "#/bilet/" + r.id : "#/etkinlik/" + r.eventId;

    return (
      '<article class="event-card" data-href="' + target + '">' +
      '<div class="cover">' + h(r.event.cover) + "</div>" +
      '<div class="event-body">' +
      '<div class="event-date">' + h(dateShort(r.event.startsAt)) + "</div>" +
      '<h3 class="event-title">' + h(r.event.title) + "</h3>" +
      '<div class="event-meta"><span>📍 ' + h(r.event.venue || r.event.city) + "</span></div>" +
      '<div class="event-foot">' + badge +
      (r.ticketCode
        ? '<span class="price-pill">🎟️ ' + h(r.ticketCode) + "</span>"
        : "") +
      "</div></div></article>"
    );
  }

  function loadMyOrganized() {
    api("/my/events").then(function (data) {
      var slot = document.getElementById("me-slot");
      if (!slot) return;

      if (!data.events.length) {
        slot.innerHTML =
          '<div class="empty"><div class="e-ico">📣</div><h3>Henüz etkinlik oluşturmadın</h3>' +
          "<p>Kendi voleybol maçını ya da atölyeni dakikalar içinde yayınla.</p>" +
          '<p style="margin-top:14px"><a class="btn btn-primary" href="#/olustur">Etkinlik oluştur</a></p></div>';
        return;
      }

      slot.innerHTML =
        '<div class="event-grid">' +
        data.events
          .map(function (ev) {
            return (
              '<article class="event-card" data-href="#/etkinlik/' + ev.id + '/katilimcilar">' +
              '<div class="cover">' + h(ev.cover) + "</div>" +
              '<div class="event-body">' +
              '<div class="event-date">' + h(dateShort(ev.startsAt)) + "</div>" +
              '<h3 class="event-title">' + h(ev.title) + "</h3>" +
              '<div class="event-meta"><span>👥 ' + ev.attendeeCount + "/" + ev.capacity + "</span>" +
              "<span>💰 " + h(money(ev.earnings.payable, ev.currency)) + " alacak</span></div>" +
              '<div class="event-foot">' +
              (ev.status === "cancelled"
                ? '<span class="badge danger">İptal</span>'
                : ev.isPast
                  ? '<span class="badge">Tamamlandı</span>'
                  : '<span class="badge ok">Yayında</span>') +
              '<span class="badge info">' + ev.earnings.paid_count + " ödeme</span>" +
              "</div></div></article>"
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
    if (!state.user) return requireLogin("#/etkinlik/" + eventId + "/katilimcilar");
    loading();

    Promise.all([
      api("/events/" + eventId),
      api("/events/" + eventId + "/attendees"),
    ])
      .then(function (results) {
        var ev = results[0].event;
        var attendees = results[1].attendees;

        var confirmed = attendees.filter(function (a) {
          return a.status === "confirmed";
        });

        view.innerHTML =
          '<a href="#/etkinlik/' + ev.id + '" class="btn btn-ghost btn-sm" style="margin-bottom:14px">← Etkinlik</a>' +
          '<div class="page-head"><div><h1 class="page-title">Katılımcılar</h1>' +
          '<p class="page-sub">' + h(ev.title) + " · " + confirmed.length + "/" + ev.capacity + " kişi</p></div></div>" +

          '<div class="card"><h2 class="section-title" style="margin-top:0">Giriş kontrolü</h2>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<input id="checkin-code" placeholder="ABCD-1234" style="flex:1;min-width:180px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);font-size:16px;text-transform:uppercase" />' +
          '<button class="btn btn-primary" id="checkin-btn">Kodu doğrula</button></div>' +
          '<div id="checkin-result" style="margin-top:12px"></div></div>' +

          '<div class="card"><h2 class="section-title" style="margin-top:0">Liste</h2>' +
          (attendees.length
            ? '<div class="table-wrap"><table class="data"><thead><tr>' +
              "<th>Ad</th><th>İletişim</th><th>Bilet</th><th>Ödeme</th><th>Durum</th>" +
              "</tr></thead><tbody>" +
              attendees
                .map(function (a) {
                  return (
                    "<tr><td><b>" + h(a.name) + "</b></td>" +
                    '<td style="color:var(--muted)">' + h(a.email) +
                    (a.phone ? "<br>" + h(a.phone) : "") + "</td>" +
                    '<td class="num">' + h(a.ticketCode) + "</td>" +
                    '<td class="num">' + h(money(a.amountMinor, ev.currency)) +
                    (a.paymentStatus
                      ? ' <span class="badge ' + (a.paymentStatus === "paid" ? "ok" : a.paymentStatus === "refunded" ? "warn" : "") + '">' +
                        h(paymentLabel(a.paymentStatus)) + "</span>"
                      : "") +
                    "</td>" +
                    "<td>" +
                    (a.status === "confirmed"
                      ? a.checkedInAt
                        ? '<span class="badge ok">Giriş yaptı</span>'
                        : '<span class="badge info">Bekleniyor</span>'
                      : '<span class="badge">' + h(a.status) + "</span>") +
                    "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">👥</div><h3>Henüz katılımcı yok</h3></div>') +
          "</div>";

        document.getElementById("checkin-btn").addEventListener("click", function () {
          var code = document.getElementById("checkin-code").value.trim().toUpperCase();
          var out = document.getElementById("checkin-result");
          if (!code) return;

          api("/events/" + ev.id + "/checkin", { method: "POST", body: { code: code } })
            .then(function (res) {
              out.innerHTML = '<div class="alert alert-success">✓ ' + h(res.name) + " içeri alındı.</div>";
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
    return {
      paid: "Ödendi",
      pending: "Bekliyor",
      refunded: "İade",
      failed: "Başarısız",
    }[status] || status;
  }

  // ── Görünüm: Etkinlik oluştur ────────────────────────────────────────────

  function viewCreate() {
    renderShell("create");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/olustur");

    var covers = ["🏐", "⚽", "🏀", "🎾", "🧘", "🏃", "🌲", "💻", "🎨", "🎸", "☕", "🎉"];
    var now = new Date(Date.now() + 24 * 3600 * 1000);
    now.setMinutes(0, 0, 0);
    var defaultDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    view.innerHTML =
      '<div class="page-head"><div><h1 class="page-title">Etkinlik oluştur</h1>' +
      '<p class="page-sub">Ücreti sen belirle; katılımcılar uygulamadan ödesin.</p></div></div>' +
      '<div class="card"><form id="create-form" novalidate>' +
      '<div id="create-error" class="alert alert-error" hidden></div>' +

      '<div class="field"><label>Kapak simgesi</label>' +
      '<div class="chips" id="cover-chips">' +
      covers
        .map(function (c, i) {
          return (
            '<button type="button" class="chip ' + (i === 0 ? "active" : "") +
            '" data-cover="' + c + '" style="font-size:1.1rem">' + c + "</button>"
          );
        })
        .join("") +
      "</div></div>" +

      '<div class="field"><label for="c-title">Başlık</label>' +
      '<input id="c-title" placeholder="Salı Akşamı Voleybol" maxlength="120" required /></div>' +

      '<div class="field"><label for="c-desc">Açıklama</label>' +
      '<textarea id="c-desc" placeholder="Seviye, ekipman, buluşma noktası…"></textarea></div>' +

      '<div class="field-row">' +
      '<div class="field"><label for="c-category">Kategori</label>' +
      '<select id="c-category">' +
      ["Spor", "Doğa", "Sağlık", "Teknoloji", "Sanat", "Müzik", "Sosyal"]
        .map(function (c) {
          return '<option>' + c + "</option>";
        })
        .join("") +
      "</select></div>" +
      '<div class="field"><label for="c-level">Seviye</label>' +
      '<select id="c-level">' +
      ["Herkes", "Başlangıç", "Orta", "İleri"]
        .map(function (c) {
          return "<option>" + c + "</option>";
        })
        .join("") +
      "</select></div></div>" +

      '<div class="field-row">' +
      '<div class="field"><label for="c-city">Şehir</label>' +
      '<input id="c-city" placeholder="İstanbul" value="' + h(state.user.city || "") + '" required /></div>' +
      '<div class="field"><label for="c-venue">Mekân</label>' +
      '<input id="c-venue" placeholder="Kadıköy Spor Salonu" /></div></div>' +

      '<div class="field"><label for="c-address">Adres</label>' +
      '<input id="c-address" placeholder="Caferağa Mah. Spor Cad. No:12" /></div>' +

      '<div class="field-row">' +
      '<div class="field"><label for="c-start">Başlangıç</label>' +
      '<input id="c-start" type="datetime-local" value="' + defaultDate + '" required /></div>' +
      '<div class="field"><label for="c-duration">Süre (saat)</label>' +
      '<input id="c-duration" type="number" min="1" max="12" value="2" /></div></div>' +

      '<div class="field-row">' +
      '<div class="field"><label for="c-capacity">Kontenjan</label>' +
      '<input id="c-capacity" type="number" min="1" max="1000" value="12" required /></div>' +
      '<div class="field"><label for="c-price">Kişi başı ücret (' + h(state.config.currencySymbol) + ")</label>" +
      '<input id="c-price" type="number" min="0" step="1" value="150" />' +
      '<div class="hint">0 yazarsan etkinlik ücretsiz olur.</div></div></div>' +

      '<div class="alert alert-info">Katılımcı ödemeleri ' + h(state.config.ownerName) +
      " hesabında toplanır. Etkinlik sonrası payın (%" +
      Math.round((1 - state.config.commissionRate) * 100) +
      ") sana aktarılır.</div>" +

      '<button type="submit" class="btn btn-primary btn-full" id="create-btn">Etkinliği yayınla</button>' +
      "</form></div>";

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
      btn.textContent = "Yayınlanıyor…";

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
          priceMinor: Math.round(Number(document.getElementById("c-price").value || 0) * 100),
        },
      })
        .then(function (res) {
          toast("Etkinliğin yayında 🎉");
          go("#/etkinlik/" + res.event.id);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = "Etkinliği yayınla";
        });
    });
  }

  // ── Görünüm: Profil ──────────────────────────────────────────────────────

  function viewProfile() {
    renderShell("profile");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/profil");

    var u = state.user;

    view.innerHTML =
      '<div class="card" style="text-align:center">' +
      '<div class="avatar lg" style="margin:0 auto 12px">' + h(initialsOf(u.name)) + "</div>" +
      '<h1 class="page-title" style="font-size:1.3rem">' + h(u.name) + "</h1>" +
      '<p class="page-sub">' + h(u.email) + (u.city ? " · " + h(u.city) : "") + "</p>" +
      (u.role === "owner" ? '<div style="margin-top:10px"><span class="badge ok">Uygulama sahibi</span></div>' : "") +
      "</div>" +

      (u.role === "owner"
        ? '<div class="card"><a class="btn btn-primary btn-full" href="#/panel">📊 Gelir panelini aç</a></div>'
        : "") +

      '<div class="card"><h2 class="section-title" style="margin-top:0">Bilgilerim</h2>' +
      '<form id="profile-form">' +
      '<div id="profile-error" class="alert alert-error" hidden></div>' +
      '<div class="field"><label for="p-name">Ad soyad</label><input id="p-name" value="' + h(u.name) + '" /></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="p-city">Şehir</label><input id="p-city" value="' + h(u.city || "") + '" /></div>' +
      '<div class="field"><label for="p-phone">Telefon</label><input id="p-phone" value="' + h(u.phone || "") + '" /></div>' +
      "</div>" +
      '<div class="field"><label for="p-bio">Hakkımda</label><textarea id="p-bio">' + h(u.bio || "") + "</textarea></div>" +
      '<button class="btn btn-primary" id="p-save">Kaydet</button>' +
      "</form></div>" +

      '<div class="card"><h2 class="section-title" style="margin-top:0">Ödeme geçmişim</h2>' +
      '<div id="pay-history"><div class="skeleton" style="height:60px"></div></div></div>' +

      '<div class="card"><button class="btn btn-danger btn-full" id="logout">Çıkış yap</button></div>';

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
          toast("Bilgilerin güncellendi.");
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
        toast("Çıkış yapıldı.");
        go("#/");
      });
    });

    api("/my/payments").then(function (data) {
      var slot = document.getElementById("pay-history");
      if (!slot) return;
      if (!data.payments.length) {
        slot.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Henüz ödeme yok.</p>';
        return;
      }
      slot.innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr>' +
        "<th>Etkinlik</th><th>Tutar</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>" +
        data.payments
          .map(function (p) {
            return (
              "<tr><td>" + h(p.cover) + " " + h(p.eventTitle) + "</td>" +
              '<td class="num">' + h(money(p.amountMinor, p.currency)) + "</td>" +
              '<td><span class="badge ' + (p.status === "paid" ? "ok" : p.status === "refunded" ? "warn" : "") + '">' +
              h(paymentLabel(p.status)) + "</span></td>" +
              '<td class="num" style="color:var(--muted)">' +
              h(new Date(p.paidAt || p.createdAt).toLocaleDateString("tr-TR")) + "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>";
    });
  }

  // ── Görünüm: Uygulama sahibi paneli ──────────────────────────────────────

  function viewOwner() {
    renderShell("owner");
    document.body.classList.remove("has-action-bar");
    if (!state.user) return requireLogin("#/panel");
    loading();

    Promise.all([api("/owner/summary"), api("/owner/payments")])
      .then(function (results) {
        var s = results[0];
        var payments = results[1].payments;
        var t = s.totals;

        view.innerHTML =
          '<div class="page-head"><div><h1 class="page-title">Gelir paneli</h1>' +
          '<p class="page-sub">Tüm katılım ücretleri bu hesapta toplanıyor · ödeme altyapısı: ' +
          h(s.provider === "stripe" ? "Stripe (canlı)" : "demo") + "</p></div></div>" +

          '<div class="stat-grid">' +
          statBox("Toplam tahsilat", money(t.gross, s.currency), true) +
          statBox("Platform komisyonu (%" + Math.round(s.commissionRate * 100) + ")", money(t.commission, s.currency)) +
          statBox("Organizatörlere borç", money(t.organizer_payable, s.currency)) +
          statBox("İade edilen", money(t.refunded, s.currency)) +
          "</div>" +

          '<div class="stat-grid" style="margin-top:12px">' +
          statBox("Ödeme sayısı", String(t.paid_count)) +
          statBox("Bekleyen ödeme", String(t.pending_count)) +
          statBox("Kayıtlı kullanıcı", String(s.counts.users)) +
          statBox("Yayındaki etkinlik", String(s.counts.events)) +
          "</div>" +

          '<div class="card" style="margin-top:14px"><h2 class="section-title" style="margin-top:0">Etkinlik bazında</h2>' +
          (s.byEvent.length
            ? '<div class="table-wrap"><table class="data"><thead><tr>' +
              "<th>Etkinlik</th><th>Organizatör</th><th>Ödeme</th><th>Tahsilat</th><th>Komisyon</th><th>Ödenecek</th>" +
              "</tr></thead><tbody>" +
              s.byEvent
                .map(function (e) {
                  return (
                    "<tr><td><b>" + h(e.cover) + " " + h(e.title) + "</b><br>" +
                    '<span style="color:var(--muted);font-size:.8rem">' + h(dateShort(e.starts_at)) + " · " + h(e.city) + "</span></td>" +
                    "<td>" + h(e.organizer_name) + "</td>" +
                    '<td class="num">' + e.paid_count + "</td>" +
                    '<td class="num">' + h(money(e.gross, s.currency)) + "</td>" +
                    '<td class="num">' + h(money(e.commission, s.currency)) + "</td>" +
                    '<td class="num">' + h(money(e.payable, s.currency)) + "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">💸</div><h3>Henüz ödeme yok</h3></div>') +
          "</div>" +

          '<div class="card"><h2 class="section-title" style="margin-top:0">Son ödemeler</h2>' +
          (payments.length
            ? '<div class="table-wrap"><table class="data"><thead><tr>' +
              "<th>#</th><th>Kullanıcı</th><th>Etkinlik</th><th>Tutar</th><th>Durum</th><th>Yöntem</th>" +
              "</tr></thead><tbody>" +
              payments
                .map(function (p) {
                  return (
                    '<tr><td class="num">' + p.id + "</td>" +
                    "<td><b>" + h(p.userName) + "</b><br>" +
                    '<span style="color:var(--muted);font-size:.8rem">' + h(p.userEmail) + "</span></td>" +
                    "<td>" + h(p.cover) + " " + h(p.eventTitle) + "</td>" +
                    '<td class="num">' + h(money(p.amountMinor, p.currency)) + "</td>" +
                    '<td><span class="badge ' +
                    (p.status === "paid" ? "ok" : p.status === "refunded" ? "warn" : p.status === "failed" ? "danger" : "") +
                    '">' + h(paymentLabel(p.status)) + "</span></td>" +
                    '<td style="color:var(--muted)">' + h(p.provider) +
                    (p.cardLast4 ? " ••" + h(p.cardLast4) : "") + "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div>"
            : '<div class="empty"><div class="e-ico">🧾</div><h3>Kayıt yok</h3></div>') +
          "</div>";
      })
      .catch(function (err) {
        errorView(err.message);
      });
  }

  function statBox(label, value, accent) {
    return (
      '<div class="stat' + (accent ? " accent" : "") + '">' +
      '<div class="label">' + h(label) + "</div>" +
      '<div class="value">' + h(value) + "</div></div>"
    );
  }

  // ── Görünüm: Giriş / kayıt ───────────────────────────────────────────────

  function requireLogin(next) {
    sessionStorage.setItem("bulus.next", next);
    go("#/giris");
  }

  function viewAuth(mode) {
    renderShell("auth");
    document.body.classList.remove("has-action-bar");
    var isLogin = mode === "login";

    view.className = "auth-wrap";
    view.innerHTML =
      '<div class="auth-card">' +
      '<div class="auth-hero"><div class="brand-mark">🎟️</div>' +
      "<h1>" + (isLogin ? "Tekrar hoş geldin" : "Buluş'a katıl") + "</h1>" +
      "<p>" + (isLogin ? "Etkinliklerine devam et." : "Birkaç saniyede hesabını oluştur.") + "</p></div>" +

      '<div class="card">' +
      '<form id="auth-form" novalidate>' +
      '<div id="auth-error" class="alert alert-error" hidden></div>' +
      (isLogin
        ? ""
        : '<div class="field"><label for="a-name">Ad soyad</label>' +
          '<input id="a-name" autocomplete="name" placeholder="İrfan Yılmaz" required /></div>') +
      '<div class="field"><label for="a-email">E-posta</label>' +
      '<input id="a-email" type="email" autocomplete="email" placeholder="irfan@example.com" required /></div>' +
      '<div class="field"><label for="a-password">Şifre</label>' +
      '<input id="a-password" type="password" autocomplete="' +
      (isLogin ? "current-password" : "new-password") + '" placeholder="••••••••" required />' +
      (isLogin ? "" : '<div class="hint">En az 8 karakter.</div>') + "</div>" +
      (isLogin
        ? ""
        : '<div class="field"><label for="a-city">Şehir (isteğe bağlı)</label>' +
          '<input id="a-city" placeholder="İstanbul" /></div>') +
      '<button type="submit" class="btn btn-primary btn-full" id="auth-btn">' +
      (isLogin ? "Giriş yap" : "Hesap oluştur") + "</button>" +
      "</form>" +

      (isLogin
        ? '<div class="demo-box">Denemek için hazır hesaplar:<br>' +
          '<b>irfan@example.com</b> / irfan1234 &nbsp;<button data-fill="irfan@example.com|irfan1234">doldur</button><br>' +
          "<b>uygulama sahibi</b> / owner1234 &nbsp;<button data-fill=\"owner@bulus.app|owner1234\">doldur</button></div>"
        : "") +
      "</div>" +

      '<div class="auth-switch">' +
      (isLogin
        ? 'Hesabın yok mu? <a href="#/kayit">Kayıt ol</a>'
        : 'Zaten üye misin? <a href="#/giris">Giriş yap</a>') +
      ' · <a href="#/">Etkinliklere göz at</a></div>' +
      "</div>";

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
      btn.textContent = "Lütfen bekle…";

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
          var next = sessionStorage.getItem("bulus.next") || "#/";
          sessionStorage.removeItem("bulus.next");
          toast("Hoş geldin, " + res.user.name.split(" ")[0] + "!");
          go(next);
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.disabled = false;
          btn.textContent = isLogin ? "Giriş yap" : "Hesap oluştur";
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
    window.scrollTo(0, 0);

    var m;
    if (path === "/" || path === "/kesfet") return viewDiscover();
    if (path === "/giris") return viewAuth("login");
    if (path === "/kayit") return viewAuth("register");
    if ((m = path.match(/^\/etkinlik\/(\d+)\/katilimcilar$/))) return viewAttendees(m[1]);
    if ((m = path.match(/^\/etkinlik\/(\d+)$/))) return viewEventDetail(m[1]);
    if ((m = path.match(/^\/odeme\/(\d+)$/))) return viewCheckout(m[1], route.query);
    if ((m = path.match(/^\/bilet\/(\d+)$/))) return viewTicket(m[1]);
    if (path === "/etkinliklerim") return viewMyEvents(route.query);
    if (path === "/olustur") return viewCreate();
    if (path === "/profil") return viewProfile();
    if (path === "/panel") return viewOwner();

    renderShell("");
    errorView("Aradığın sayfa yok.");
  }

  // Kart tıklamalarını tek bir dinleyiciyle yakala.
  document.addEventListener("click", function (e) {
    var card = e.target.closest("[data-href]");
    if (card) {
      location.hash = card.getAttribute("data-href");
    }
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
