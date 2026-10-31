const app = document.querySelector("#app");
const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ],
  );
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
};
const hex = (value) =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#7d9271";
let project = null,
  screen = "home",
  ratingIndex = 0,
  reason = "",
  saving = false,
  pollTimer = null,
  pollFailures = 0,
  tab = "preview",
  mobile = false,
  selectedPage = 0;
let savedId;
try {
  savedId = localStorage.getItem("iikanji-project");
} catch {}
const resume = document.querySelector("#resume-button");
if (savedId) resume.classList.remove("hidden");
const badge = () =>
  project?.mode === "demo"
    ? '<span class="sample-badge">SAMPLE · 架空の会社とデザインで体験中</span>'
    : "";
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3000);
}
async function api(path, body, method) {
  const response = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("接続を確認して、もう一度お試しください。");
  }
  if (!response.ok)
    throw new Error(data.error || "処理を完了できませんでした。");
  return data;
}
function remember() {
  savedId = project.id;
  try {
    localStorage.setItem("iikanji-project", savedId);
  } catch {}
  resume.classList.remove("hidden");
}
function move(next, { scroll = true } = {}) {
  screen = next;
  clearTimeout(pollTimer);
  render();
  if (scroll) {
    window.scrollTo({ top: 0, behavior: "instant" });
    app.focus({ preventScroll: true });
  }
}
function stepper(n) {
  return `<ol class="stepper" aria-label="進行状況">${["会社を知る", "好みを選ぶ", "提案を見る"].map((label, i) => `<li class="${i < n ? "done" : i === n ? "active" : ""}" ${i === n ? 'aria-current="step"' : ""}><span class="step-number">${i < n ? "✓" : `0${i + 1}`}</span>${label}</li>`).join("")}</ol>`;
}
const wrapper = (n, content) =>
  `<section class="workspace">${stepper(n)}${content}</section>`;
function citations(urls = []) {
  return urls.length
    ? `<div class="sources">${[...new Set(urls)].map((url) => `<a class="source-link" href="${e(safeUrl(url))}" target="_blank" rel="noopener noreferrer">↗ ${e((project?.sources || []).find((s) => s.url === url)?.title || new URL(safeUrl(url) === "#" ? "https://example.com" : url).hostname)}</a>`).join("")}</div>`
    : "";
}
function errorBox(message) {
  return `<div class="error" role="alert">${e(message)}</div>`;
}
function renderHome() {
  app.innerHTML = `<section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="dot"></span>A NEW CHAPTER FOR YOUR WEBSITE</span><h1>いまの会社に、<br><em>ちょうどいい</em><br>ホームページ。</h1><p>会社のことも、あなたの好みも。<br>ちゃんと知ってから、新しいHPをつくります。</p><form class="url-form" id="url-form"><fieldset class="goal-options"><legend>いちばん叶えたいこと</legend><label><input type="radio" name="goal" value="inquiry" checked>問い合わせを増やす</label><label><input type="radio" name="goal" value="brand">魅力を伝える</label><label><input type="radio" name="goal" value="recruit">採用につなげる</label></fieldset><label for="site-url">自社サイトのURL</label><div class="url-field"><span aria-hidden="true">↗</span><input id="site-url" name="url" inputmode="url" autocomplete="url" placeholder="https://your-company.jp" required maxlength="2048"><button class="primary-button" type="submit">サイトを調べる <span>→</span></button></div><p class="url-hint">公開サイトのURLだけ。今のサイトは変更されません。</p><div id="home-error"></div></form><button class="sample-link" id="sample-button">まずはサンプルで体験する <span>↗</span></button></div><div class="hero-visual" aria-label="好みを選んでサイトをつくるイメージ"><span class="visual-label">A LITTLE INSPIRATION.</span><div class="visual-orbit"></div><div class="mock-browser mock-back"><div class="browser-bar"><i></i><i></i><i></i><span>FORM / SAMPLE</span></div><div class="mock-content"><div class="mock-nav">FORM /</div><p><strong>Make room<br>for better.</strong></p><div class="green-box"></div></div></div><div class="mock-browser mock-front"><div class="browser-bar"><i></i><i></i><i></i><span>ATELIER / SAMPLE</span></div><div class="mock-content"><div class="mock-nav"><b>atelier.</b><small>ABOUT &nbsp; WORKS &nbsp; CONTACT</small></div><h3>A little more<br>meaningful.</h3><div class="room"><div class="window"></div><div class="chair"></div><div class="plant"></div></div><div class="mock-footer"><span>SPACES FOR EVERYDAY LIFE</span><span>VIEW WORKS ↗</span></div></div></div><div class="like-sticker">この雰囲気、好き。<span class="sticker-stars" aria-label="5つ星">★★★★★</span></div><div class="taste-pill"><b>✳</b>「好き」が、いいHPのヒントに。</div></div></section><section class="how-strip" aria-label="3つのステップ"><div class="how-item"><span>01</span><div><b>会社を、ちゃんと知る。</b><p>事業・強み・競合を、公開情報から整理。</p></div></div><div class="how-item"><span>02</span><div><b>10件を、直感で選ぶ。</b><p>業界を越えた参考サイトを、1〜5点で採点。</p></div></div><div class="how-item"><span>03</span><div><b>次のHPに、出会う。</b><p>元の情報を引き継いだ、新しい見せ方を提案。</p></div></div></section><section class="home-note"><span class="spark" aria-hidden="true">✳</span><div><h2>大事にしてきたことは、そのままに。</h2><p>会社の情報、ページのつながり、伝えたいこと。<br>引き継げた内容を確かめながら、これからの見せ方を考えます。</p></div></section>`;
  document.querySelector("#url-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await start(
      { url: form.elements.url.value, goal: form.elements.goal.value },
      form.querySelector("button"),
    );
  };
  document.querySelector("#sample-button").onclick = (event) =>
    start({ mode: "demo" }, event.currentTarget);
}
async function start(body, button) {
  button.disabled = true;
  const old = button.innerHTML;
  button.innerHTML = '<span class="inline-spinner"></span> 準備しています';
  try {
    project = await api("/api/projects", body);
    remember();
    ratingIndex = 0;
    move(project.status === "ready" ? "research" : "progress");
  } catch (error) {
    document.querySelector("#home-error").innerHTML = errorBox(error.message);
    button.disabled = false;
    button.innerHTML = old;
  }
}
function renderProgress() {
  const building = project.status === "building";
  app.innerHTML = wrapper(
    building ? 2 : 0,
    `<div class="progress-layout"><span class="progress-flower" aria-hidden="true">✳</span>${badge()}<h1>${building ? "あなたらしい見せ方を、<br>組み立てています。" : "会社のことを、<br>ひとつずつ調べています。"}</h1><p class="muted">${building ? "採点を反映しながら、元の情報との対応を確認しています。" : "自社の情報と外部の情報を照らし合わせます。数分かかることがあります。"}</p><div class="progress-log" role="status" aria-live="polite">${building ? '<span><b>✓ 10件の採点を受け取りました</b></span><span class="working"><i class="mini-loader"></i>構成とデザインを検討しています</span><span>本文・リンク・パンくずを検査します</span>' : `<span class="${project.status === "crawling" ? "working" : ""}">${project.status === "crawling" ? '<i class="mini-loader"></i>' : "✓ "}公開ページを取得 ${project.progress?.pages ? `· ${project.progress.pages}ページ確認済み` : ""}</span><span class="${project.status === "researching" ? "working" : ""}">${project.status === "researching" ? '<i class="mini-loader"></i>' : ""}事業・競合・出典を調査</span><span>10件の参考サイトを整理</span>`}</div><p class="muted">この画面を再読み込みしても、つづきから確認できます。</p><div id="poll-error"></div></div>`,
  );
  poll();
}
function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      project = await api(`/api/projects/${project.id}`);
      pollFailures = 0;
      if (project.status === "complete") {
        tab = "preview";
        move("proposal");
      } else if (project.status === "ready") move("research");
      else if (project.status === "error") move("error");
      else renderProgress();
    } catch (error) {
      pollFailures++;
      const target = document.querySelector("#poll-error");
      if (target)
        target.innerHTML = errorBox(
          pollFailures >= 4
            ? "接続を確認できません。「つづきから」で再接続してください。"
            : error.message,
        );
      if (pollFailures < 4) poll();
    }
  }, 1500);
}
function renderResearch() {
  const r = project.research;
  app.innerHTML = wrapper(
    0,
    `<div class="page-heading"><div>${badge()}<span class="eyebrow">YOUR COMPANY, IN FOCUS</span><h1>${e(r.company.name)}の、今とこれから。</h1><p>まずは会社を知るところから。調査の根拠も、ここで確認できます。</p></div><button class="primary-button" id="start-rating">好みを選びにいく <span>→</span></button></div><div class="report-grid"><section class="panel"><span class="eyebrow">01 / COMPANY</span><p class="company-intro">${e(r.company.summary)}</p><div class="company-meta"><span class="tag">${e(r.company.industry)}</span></div><p class="muted">届けたい相手：${e(r.company.audience)}</p>${r.company.positioning.map((c) => `<div class="evidence-item"><span class="kind ${c.kind === "hypothesis" ? "hypothesis" : ""}">${{ fact: "出典あり", estimate: "推定", hypothesis: "仮説" }[c.kind] || "仮説"}</span><p>${e(c.text)}</p>${citations(c.sourceUrls)}</div>`).join("")}<div class="stats"><div><strong>${project.inventory.pages.length}</strong><small>取得できたページ</small></div><div><strong>${project.sources.length}</strong><small>参照した公開情報</small></div><div><strong>10</strong><small>参考デザイン</small></div></div></section><section class="panel"><span class="eyebrow">02 / COMPETITORS</span><h2 style="margin-top:16px">比較される相手を知る。</h2>${r.competitors.map((c) => `<div class="competitor"><b>${c.url ? `<a href="${e(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${e(c.name)} ↗</a>` : e(c.name)}</b><p>${e(c.why)}</p><span class="growth-label">${c.growth.status === "unknown" ? "成長傾向は未確認" : `${c.growth.status === "estimated" ? "推定" : "観測"} · ${e(c.growth.metric)} ${e(c.growth.fromValue)} → ${e(c.growth.toValue)} ${e(c.growth.unit)} (${e(c.growth.periodFrom)}〜${e(c.growth.periodTo)})`}</span>${citations([...c.sourceUrls, ...c.growth.sourceUrls])}</div>`).join("")}<p class="muted">見た目や検索順位だけで「伸びている」とは判断していません。</p></section><section class="panel wide"><span class="eyebrow">03 / OPPORTUNITIES</span><h2 style="margin-top:16px">次のHPで、もっと伝わること。</h2><div class="recommendation-grid">${r.recommendations.map((rec, i) => `<article class="recommendation"><span>0${i + 1}</span><h3>${e(rec.title)}</h3><p>${e(rec.detail)}</p>${citations(rec.sourceUrls)}</article>`).join("")}</div></section></div><div class="next-row"><p class="muted">次は10件の参考デザインを採点。<br>正解はありません。「好き」の感覚でどうぞ。</p><button class="primary-button" id="start-rating-bottom">10件の参考デザインを見る →</button></div><div class="bottom-actions"><button class="back-button" id="go-home">← 最初の画面へ</button><button class="danger-button" id="delete-project">この調査を削除</button></div>`,
  );
  const next = () => {
    ratingIndex = project.research.references.findIndex(
      (r) => !project.ratings[r.id],
    );
    if (ratingIndex < 0) ratingIndex = 10;
    move(ratingIndex === 10 ? "summary" : "rating");
  };
  document.querySelector("#start-rating").onclick = next;
  document.querySelector("#start-rating-bottom").onclick = next;
  bindCommon();
}
function renderRating() {
  if (ratingIndex >= 10) return move("summary");
  const ref = project.research.references[ratingIndex];
  reason = project.ratings[ref.id]?.reason || "";
  const count = Object.keys(project.ratings).length;
  app.innerHTML = wrapper(
    1,
    `<div class="page-heading"><div>${badge()}<span class="eyebrow">FIND YOUR KIND OF GOOD</span><h1>この雰囲気、どのくらい好き？</h1><p>理由はうまく言えなくても大丈夫。直感で1〜5点をつけてください。</p></div><button class="back-button" id="back-research">← 調査結果へ</button></div><div class="rating-layout"><div><article class="reference-card" id="swipe-card"><div class="reference-topline"><span>${e(ref.industry)}</span>${ref.url ? `<a href="${e(safeUrl(ref.url))}" target="_blank" rel="noopener noreferrer">実際のサイトを開く ↗</a>` : "<span>架空の参考デザイン</span>"}</div><div class="reference-preview" id="reference-preview">${project.mode === "demo" ? `<iframe src="/api/projects/${project.id}/reference?id=${ref.id}" title="${e(ref.name)}の参考デザイン" sandbox="" tabindex="-1"></iframe>` : `<img src="https://s.wordpress.com/mshots/v1/${encodeURIComponent(ref.url)}?w=1000" alt="${e(ref.name)}のサイトプレビュー" referrerpolicy="no-referrer"><div class="preview-fallback hidden">プレビューを取得できませんでした。<br><a href="${e(safeUrl(ref.url))}" target="_blank" rel="noopener noreferrer">実際のサイトを開いて確認 ↗</a></div>`}</div><div class="reference-caption"><div><h2>${e(ref.name)}</h2><p>${ref.url ? e(new URL(ref.url).hostname) : "SAMPLE DESIGN COLLECTION"}</p></div><div class="counter">${String(ratingIndex + 1).padStart(2, "0")}<span>/ 10</span></div></div></article><div class="score-area"><p class="score-prompt" id="score-prompt">あなたの「いい感じ」を教えてください。</p><div class="score-buttons" role="group" aria-labelledby="score-prompt">${[1, 2, 3, 4, 5].map((n) => `<button class="score-button ${project.ratings[ref.id]?.value === n ? "current" : ""}" data-score="${n}" aria-label="${n}点${n === 1 ? "：好みではない" : n === 5 ? "：とても好き" : ""}">${n}</button>`).join("")}</div><div class="score-legend"><span>好みではない</span><span>どちらでもない</span><span>とても好き</span></div></div><div id="rating-error"></div><div class="rating-bottom"><button class="back-button" id="previous-rating" ${ratingIndex === 0 ? "disabled" : ""}>↶ ひとつ前へ</button><span>1〜5キーでも採点できます</span></div></div><aside class="rating-sidebar"><div><span class="eyebrow">WHAT TO LOOK AT</span><h2>参考にしたいところ</h2><p>${e(ref.why)}</p><div class="swatch-row" aria-label="参考にする配色案">${Object.values(
      ref.colors,
    )
      .map((c) => `<span class="swatch" style="background:${hex(c)}"></span>`)
      .join(
        "",
      )}</div><p>${e(ref.transfer)}</p>${ref.previewNote ? `<p class="muted">${e(ref.previewNote)}</p>` : ""}</div><div class="sidebar-reason"><div class="reason-title">気になったところがあれば（任意）</div><div class="reason-buttons">${["余白", "色づかい", "文字", "写真の見せ方", "情報の量", "読みやすさ"].map((text) => `<button class="reason-button ${reason === text ? "selected" : ""}" aria-pressed="${reason === text}" data-reason="${text}">${text}</button>`).join("")}</div><div class="progress-dots" aria-label="${count}件採点済み">${Array.from({ length: 10 }, (_, i) => `<i class="${i < count ? "complete" : ""}"></i>`).join("")}</div></div></aside></div>`,
  );
  document.querySelector("#back-research").onclick = () => move("research");
  document.querySelector("#previous-rating").onclick = () => {
    ratingIndex--;
    move("rating", { scroll: false });
  };
  document
    .querySelectorAll("[data-score]")
    .forEach((b) => (b.onclick = () => rate(Number(b.dataset.score))));
  document.querySelectorAll("[data-reason]").forEach(
    (b) =>
      (b.onclick = () => {
        reason = reason === b.dataset.reason ? "" : b.dataset.reason;
        document.querySelectorAll("[data-reason]").forEach((x) => {
          x.classList.toggle("selected", x.dataset.reason === reason);
          x.setAttribute("aria-pressed", String(x.dataset.reason === reason));
        });
      }),
  );
  const image = document.querySelector("#reference-preview img");
  if (image)
    image.onerror = () => {
      image.hidden = true;
      document.querySelector(".preview-fallback").classList.remove("hidden");
    };
  scaleReference();
  let pointer = null;
  const card = document.querySelector("#swipe-card");
  card.onpointerdown = (event) => {
    if (event.target.closest("a")) return;
    pointer = { x: event.clientX, y: event.clientY };
  };
  card.onpointerup = (event) => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x,
      dy = event.clientY - pointer.y;
    pointer = null;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 65) rate(dx > 0 ? 5 : 1);
  };
}
function scaleReference() {
  const view = document.querySelector(".reference-preview");
  const frame = view?.querySelector("iframe");
  if (frame) frame.style.transform = `scale(${view.clientWidth / 800})`;
}
window.addEventListener("resize", scaleReference);
async function rate(value) {
  if (saving || screen !== "rating") return;
  saving = true;
  document
    .querySelectorAll("[data-score],#previous-rating")
    .forEach((b) => (b.disabled = true));
  try {
    project = await api(`/api/projects/${project.id}/ratings`, {
      referenceId: project.research.references[ratingIndex].id,
      value,
      reason,
    });
    ratingIndex++;
    move(Object.keys(project.ratings).length === 10 ? "summary" : "rating", {
      scroll: false,
    });
  } catch (error) {
    document.querySelector("#rating-error").innerHTML = errorBox(error.message);
    document
      .querySelectorAll("[data-score]")
      .forEach((b) => (b.disabled = false));
  } finally {
    saving = false;
  }
}
document.addEventListener("keydown", (event) => {
  if (
    screen === "rating" &&
    /^[1-5]$/.test(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !document.querySelector("dialog[open]") &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  ) {
    event.preventDefault();
    rate(Number(event.key));
  }
});
function renderSummary() {
  const refs = project.research.references;
  const favorites = refs.filter((r) => project.ratings[r.id]?.value >= 4);
  app.innerHTML = wrapper(
    1,
    `<div class="page-heading"><div>${badge()}<span class="eyebrow">YOUR TASTE, TAKING SHAPE</span><h1>10件、ありがとう。<br>次は、あなたの会社のHPへ。</h1><p>採点をヒントに、会社の情報と好みを組み合わせます。</p></div></div><div class="rating-summary"><section class="taste-summary"><span class="eyebrow">YOUR FAVORITES</span><h2>${
      favorites.length
        ? favorites
            .slice(0, 3)
            .map((r) => e(r.name))
            .join("<br>")
        : "読みやすさから、<br>方向を探してみましょう。"
    }</h2><p>${favorites.length ? "4点以上をつけたデザインです。会社の情報に合わせて、色・文字・余白の使い方を参考にします。" : "強く好みに合うものがなかったため、中立的な構成から提案します。採点を見直すこともできます。"}</p><p>会社情報とページのつながりは引き継ぎます。<br>見た目を変えても、大事なことはそのままに。</p></section><section class="panel"><h2>あなたの採点</h2><ol class="rated-list">${refs.map((r, i) => `<li><span class="color-dot" style="background:${hex(r.colors.accent)}"></span><span>${e(r.name)}</span><b>${project.ratings[r.id].value} / 5</b><button data-edit="${i}" aria-label="${e(r.name)}の採点を変更">変更</button></li>`).join("")}</ol></section></div><div class="next-row"><p class="muted">10件から分かる範囲を反映した、最初の提案です。<br>確認したあとで、採点を変えてつくり直せます。</p><button class="primary-button" id="build-button">この好みで、新しいHPを見る <span>→</span></button></div><div id="summary-error"></div>`,
  );
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        ratingIndex = Number(b.dataset.edit);
        move("rating");
      }),
  );
  document.querySelector("#build-button").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      project = await api(`/api/projects/${project.id}/proposal`, {});
      move(project.status === "complete" ? "proposal" : "progress");
    } catch (error) {
      document.querySelector("#summary-error").innerHTML = errorBox(
        error.message,
      );
      document.querySelector("#build-button").disabled = false;
    }
  };
}
function renderProposal() {
  const p = project.proposal,
    a = p.audit;
  const page =
    project.inventory.pages[selectedPage] || project.inventory.pages[0];
  app.innerHTML = wrapper(
    2,
    `<div class="page-heading"><div>${badge()}<span class="eyebrow">YOUR NEXT CHAPTER</span><h1>${e(project.research.company.name)}の、新しい見せ方。</h1><p>${e(p.profile.summary)} · ${e(p.profile.confidence)}</p></div><a class="primary-button" href="/api/projects/${project.id}/download">提案をダウンロード ↓</a></div><nav class="proposal-tabs" aria-label="提案の表示"><button data-tab="preview" class="${tab === "preview" ? "active" : ""}" aria-current="${tab === "preview" ? "page" : "false"}">新しいHP</button><button data-tab="reason" class="${tab === "reason" ? "active" : ""}">変更の理由</button><button data-tab="audit" class="${tab === "audit" ? "active" : ""}">引き継ぎチェック</button></nav>${
      tab === "preview"
        ? `<div class="proposal-toolbar"><select id="page-select" aria-label="プレビューするページ">${project.inventory.pages.map((page, i) => `<option value="${i}" ${i === selectedPage ? "selected" : ""}>${e(page.title)}</option>`).join("")}</select><div class="view-toggle" role="group" aria-label="画面サイズ"><button id="desktop-view" class="${!mobile ? "active" : ""}" aria-pressed="${!mobile}">PC</button><button id="mobile-view" class="${mobile ? "active" : ""}" aria-pressed="${mobile}">スマホ</button></div></div><div class="preview-stage"><iframe id="proposal-frame" class="proposal-frame ${mobile ? "mobile" : ""}" title="${e(page.title)}のリニューアル提案" src="/api/projects/${project.id}/preview?url=${encodeURIComponent(page.url)}" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div><p class="muted">確認用の仮サイトです。現在のサイトには反映されていません。</p>`
        : tab === "reason"
          ? `<div class="report-grid"><section class="panel"><h2>採点から反映したこと</h2><p>${e(p.profile.summary)}</p><p>デザインの方向：${e(p.theme.name)}</p><div class="swatch-row">${[p.theme.background, p.theme.foreground, p.theme.accent].map((c) => `<span class="swatch" style="background:${hex(c)}"></span>`).join("")}</div><p class="muted">${e(p.profile.confidence)}。会社を訪れる人の使いやすさは、公開後の成果と合わせて確かめます。</p></section><section class="panel"><h2>これから検証したいこと</h2><p>訪問者が事業を理解できるか、必要な情報を見つけられるか、相談先へ進めるか。</p><p class="muted">見た目の好み、検索での見つけやすさ、問い合わせの成果は別々に確認します。</p></section>${p.plan.pages.map((page) => `<section class="panel wide"><h2>${e(project.inventory.pages.find((x) => x.url === page.url)?.title)}</h2><p>${e(page.rationale)}</p><div class="recommendation-grid">${page.improvements.map((x, i) => `<article class="recommendation"><span>0${i + 1}</span><h3>${e(x.title)}</h3><p>${e(x.detail)}</p>${citations(x.sourceUrls)}</article>`).join("")}</div></section>`).join("")}</div>`
          : `<div class="panel"><span class="${a.passed ? "pass-chip" : "sample-badge"}">${a.passed ? "✓ 取得した本文の保持を確認" : "確認が必要な項目があります"}</span><h2 style="margin-top:20px">引き継げた範囲を、見える形に。</h2><p>${e(a.scope)}を対象に確認しています。サイト全体の完全な移植を保証するものではありません。</p><div class="audit-grid">${[
              [a.pages, "取得ページ"],
              [`${a.retained} / ${a.blocks}`, "保持した本文"],
              [a.links, "元のリンク"],
              [a.breadcrumbs, "パンくずの項目"],
            ]
              .map(
                ([n, label]) =>
                  `<div class="audit-tile"><strong>${n}</strong><span>${label}</span></div>`,
              )
              .join(
                "",
              )}</div><ul class="audit-details"><li>取得できていない・未巡回のURL：${a.unfetched}件</li><li>元ページで確認したフォーム：${a.forms}件。送信機能は元サイトを参照します。</li>${a.notes.map((note) => `<li>${e(note)}</li>`).join("")}${a.failures.map((note) => `<li>${e(note)}</li>`).join("")}</ul>${project.inventory.errors.length ? `<details><summary>取得できなかったページ</summary><ul class="audit-details">${project.inventory.errors.map((x) => `<li>${e(x.url)} — ${e(x.reason)}</li>`).join("")}</ul></details>` : ""}<p class="muted">検査日時：${e(new Date(a.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))}（日本時間）</p></div>`
    }<section class="review-banner"><div><h3>この方向、どうですか？</h3><p>採用したい点や直したい点を、この提案に残せます。</p><textarea id="feedback-note" aria-label="提案へのコメント" maxlength="1000" placeholder="例：余白は好き。文字をもう少し大きくしたい。">${e(project.feedback?.note || "")}</textarea></div><button class="secondary-button" data-feedback="accepted">この方向で進めたい ✓</button><button class="secondary-button" data-feedback="needs_changes">調整したい</button></section><div class="bottom-actions"><button class="back-button" id="back-ratings">← 好みを見直す</button><button class="back-button" id="back-research">調査結果を見る</button><button class="danger-button" id="delete-project">この提案を削除</button></div>`,
  );
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab;
        renderProposal();
      }),
  );
  if (tab === "preview") {
    document.querySelector("#page-select").onchange = (event) => {
      selectedPage = Number(event.target.value);
      renderProposal();
    };
    document.querySelector("#desktop-view").onclick = () => {
      mobile = false;
      renderProposal();
    };
    document.querySelector("#mobile-view").onclick = () => {
      mobile = true;
      renderProposal();
    };
  }
  document.querySelector("#back-ratings").onclick = () => move("summary");
  document.querySelector("#back-research").onclick = () => move("research");
  document.querySelectorAll("[data-feedback]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const note = document.querySelector("#feedback-note").value;
          await api(`/api/projects/${project.id}/feedback`, {
            decision: b.dataset.feedback,
            note,
          });
          project.feedback = { decision: b.dataset.feedback, note };
          toast("コメントを保存しました。");
        } catch (error) {
          toast(error.message);
        } finally {
          b.disabled = false;
        }
      }),
  );
  bindCommon();
}
function bindCommon() {
  const home = document.querySelector("#go-home");
  if (home) home.onclick = () => move("home");
  const del = document.querySelector("#delete-project");
  if (del)
    del.onclick = async () => {
      if (!confirm("この調査・採点・提案を削除します。よろしいですか？"))
        return;
      try {
        await api(`/api/projects/${project.id}`, {}, "DELETE");
        project = null;
        savedId = null;
        try {
          localStorage.removeItem("iikanji-project");
        } catch {}
        resume.classList.add("hidden");
        move("home");
        toast("データを削除しました。");
      } catch (error) {
        toast(error.message);
      }
    };
}
function renderError() {
  app.innerHTML = wrapper(
    0,
    `<div class="empty-error"><span class="eyebrow">LET’S TRY AGAIN</span><h1>うまく確認できませんでした。</h1>${errorBox(project.error || "接続を確認してください。")}<p class="muted">${project.research ? "調査結果と採点は保存されています。" : "URLの確認、または時間をおいての再試行をお願いします。"}</p>${project.research ? '<button class="primary-button" id="recover">保存した結果に戻る →</button>' : '<button class="primary-button" id="go-home">URL入力に戻る →</button>'}</div>`,
  );
  if (project.research)
    document.querySelector("#recover").onclick = () =>
      move(Object.keys(project.ratings).length === 10 ? "summary" : "research");
  bindCommon();
}
function render() {
  ({
    home: renderHome,
    progress: renderProgress,
    research: renderResearch,
    rating: renderRating,
    summary: renderSummary,
    proposal: renderProposal,
    error: renderError,
  })[screen]();
}
resume.onclick = async () => {
  resume.disabled = true;
  try {
    project = await api(`/api/projects/${savedId}`);
    if (project.status === "complete") move("proposal");
    else if (project.status === "ready")
      move(Object.keys(project.ratings).length === 10 ? "summary" : "research");
    else move(project.status === "error" ? "error" : "progress");
  } catch (error) {
    toast(error.message);
  } finally {
    resume.disabled = false;
  }
};
document.querySelector("#about-button").onclick = () =>
  document.querySelector("#about-dialog").showModal();
document.querySelector(".close-dialog").onclick = () =>
  document.querySelector("#about-dialog").close();
document.querySelector(".brand").onclick = (event) => {
  event.preventDefault();
  move("home");
};
render();
