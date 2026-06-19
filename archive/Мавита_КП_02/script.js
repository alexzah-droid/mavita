// =====================================================
// MAVITA KP — interactivity
// =====================================================

// ---------- elements tab switcher ----------
(function elementsTabs() {
  const tabs = document.querySelectorAll(".element-tab");
  const panels = document.querySelectorAll(".element-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.element;
      tabs.forEach((t) => t.setAttribute("aria-selected", t === tab ? "true" : "false"));
      panels.forEach((p) => p.setAttribute("data-active", p.dataset.element === target ? "true" : "false"));
    });
  });
})();

// ---------- ritual player ----------
(function ritualPlayer() {
  const player = document.getElementById("ritual-player");
  if (!player) return;

  const playBtn = player.querySelector(".play");
  const sceneBtns = player.querySelectorAll(".scene");
  const trackEl = player.querySelector(".track");
  const durationEl = player.querySelector(".duration");

  const scenes = {
    forest:   { title: "Лес после <em>дождя</em>",        dur: "12:40" },
    river:    { title: "Шум горной <em>реки</em>",        dur: "08:20" },
    sea:      { title: "Дыхание <em>моря</em>",            dur: "14:10" },
    leaves:   { title: "Шелест <em>листвы</em>",           dur: "09:55" },
    fire:     { title: "Тихий <em>костёр</em>",            dur: "21:30" },
  };

  let current = "forest";
  let playing = false;

  function applyScene(key) {
    current = key;
    const s = scenes[key];
    trackEl.innerHTML = s.title;
    durationEl.textContent = "00:00 / " + s.dur;
    sceneBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scene === key ? "true" : "false"));
  }

  function togglePlay(force) {
    playing = (typeof force === "boolean") ? force : !playing;
    player.classList.toggle("is-playing", playing);
    if (playing) startTicker(); else stopTicker();
  }

  // pseudo time progression
  let interval = null;
  let elapsed = 0;
  function startTicker() {
    stopTicker();
    interval = setInterval(() => {
      elapsed = (elapsed + 1) % 1800;
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      durationEl.textContent = `${m}:${s} / ${scenes[current].dur}`;
    }, 1000);
  }
  function stopTicker() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  playBtn.addEventListener("click", () => togglePlay());
  sceneBtns.forEach((b) => {
    b.addEventListener("click", () => {
      applyScene(b.dataset.scene);
      elapsed = 0;
      if (!playing) togglePlay(true);
    });
  });

  // build waveform bars
  const wave = player.querySelector(".wave");
  if (wave) {
    const bars = 56;
    let html = "";
    for (let i = 0; i < bars; i++) {
      const h = 16 + Math.round(Math.abs(Math.sin(i * 0.42)) * 44 + Math.random() * 16);
      const delay = (i % 12) * 0.06;
      html += `<span class="bar" style="height:${h}px;animation-delay:${delay}s"></span>`;
    }
    wave.innerHTML = html;
  }

  applyScene("forest");
})();

// ---------- scroll reveal ----------
(function reveal() {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();

// ---------- order CTA → mailto with subject ----------
(function orderCTA() {
  document.querySelectorAll("[data-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.order;
      const subject = encodeURIComponent("МАВИТА — заказ: " + name);
      const body = encodeURIComponent(
        "Здравствуйте, Виктория.\nХочу обсудить заказ: " + name + ".\n\n"
      );
      window.location.href = `mailto:mavitasvechi@mail.ru?subject=${subject}&body=${body}`;
    });
  });
})();
