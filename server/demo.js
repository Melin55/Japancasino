import { extractPage } from "./crawler.js";
import { escapeHtml } from "./design.js";

const entries = [
  [
    "quiet",
    "余白が主役のスタジオ",
    "建築・空間",
    "#efece4",
    "#333c34",
    "#62755b",
    [-0.8, 0.5, -0.4, 0.7, -0.3],
    "静かな余白と大きな写真で、仕事の質を伝える。",
  ],
  [
    "bold",
    "ひと言で伝えるプロダクト",
    "ソフトウェア",
    "#171c20",
    "#f2f3ee",
    "#b9ef67",
    [-0.5, -0.5, 0.9, -0.7, 0.9],
    "強い見出しと明確な導線で、最初の一歩をつくる。",
  ],
  [
    "journal",
    "物語のあるブランド",
    "暮らし・雑貨",
    "#f7f1e9",
    "#533b31",
    "#ba563d",
    [0.3, 0.9, -0.3, 1, -0.4],
    "読み物と商品をつなぎ、背景まで伝える。",
  ],
  [
    "precise",
    "迷わないサービス案内",
    "法人サービス",
    "#f0f3fa",
    "#20354c",
    "#3566b7",
    [0.7, -0.6, 0.2, -0.8, 0.4],
    "整理された比較と情報のまとまりで、判断を助ける。",
  ],
  [
    "play",
    "親しみのあるデザイン",
    "教育・コミュニティ",
    "#f9ecbc",
    "#343c30",
    "#ed7753",
    [-0.2, 1, 0.7, -0.6, 0.2],
    "丸みと明るい色で、話しかけやすさをつくる。",
  ],
  [
    "craft",
    "手仕事を感じる佇まい",
    "ものづくり",
    "#e7e1d4",
    "#3e4439",
    "#79734b",
    [0.1, 0.7, -0.6, 0.8, -0.5],
    "素材と細部を見せて、技術への信頼につなげる。",
  ],
  [
    "gallery",
    "写真で選ぶギャラリー",
    "旅・宿泊",
    "#f5f5f0",
    "#233d40",
    "#437d80",
    [-0.8, 0.1, 0.3, 0.2, 0.1],
    "写真に広い面積を使い、体験を直感的に伝える。",
  ],
  [
    "clear",
    "すっきりした会社案内",
    "コンサルティング",
    "#ffffff",
    "#273944",
    "#45735f",
    [0.3, -0.1, -0.5, -0.5, 0.3],
    "事業・実績・相談を短い順路でつなぐ。",
  ],
  [
    "type",
    "文字が印象に残るサイト",
    "クリエイティブ",
    "#f3eee8",
    "#352a27",
    "#c65b40",
    [-0.4, 0.4, 1, 0.8, 0.6],
    "大きなタイポグラフィで、個性を記憶に残す。",
  ],
  [
    "detail",
    "じっくり比較できるサイト",
    "専門サービス",
    "#e9eef2",
    "#26343e",
    "#52778e",
    [1, -0.4, -0.2, 0.1, 0.1],
    "詳しい説明と比較しやすい構成で、不安を解消する。",
  ],
];
export const demoReferences = entries.map(
  ([id, name, industry, background, foreground, accent, values, why]) => ({
    id,
    name,
    industry,
    url: null,
    why,
    transfer: "この見せ方を自社の情報で試します。",
    sourceUrls: [],
    features: Object.fromEntries(
      ["density", "warmth", "boldness", "editorial", "contrast"].map((k, i) => [
        k,
        values[i],
      ]),
    ),
    colors: { background, foreground, accent },
    sample: true,
  }),
);
export function sampleReferenceHtml(ref) {
  const e = escapeHtml;
  const c = ref.colors;
  const dark = ref.features.contrast > 0.6;
  const serif = ref.features.editorial > 0.4;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;color:${c.foreground};background:${c.background};font-family:${serif ? "Georgia,serif" : "Arial,sans-serif"};padding:30px 42px;min-height:590px}header{display:flex;justify-content:space-between;align-items:center;font:11px Arial;letter-spacing:.1em;border-bottom:1px solid ${c.foreground}33;padding-bottom:23px}strong{font-size:21px}main{padding:48px 0;display:grid;grid-template-columns:1.05fr 1fr;gap:30px;align-items:center}h1{font-size:${ref.features.boldness > 0.6 ? "62" : "46"}px;line-height:1.12;letter-spacing:-.06em;font-weight:${serif ? 400 : 700};margin:18px 0}p{font:13px/1.8 Arial;max-width:245px}small{font:9px Arial;letter-spacing:.12em}.button{display:inline-block;padding:13px 20px;margin-top:20px;border-radius:${ref.id === "play" ? "24" : "3"}px;background:${c.accent};color:${dark ? "#172019" : "white"};font:11px Arial}.art{height:310px;background:${c.accent}26;position:relative;overflow:hidden;border-radius:${ref.id === "play" ? "100px 100px 12px 12px" : "0"}}.one{position:absolute;background:${c.accent};width:160px;height:210px;left:35px;top:75px;transform:rotate(-12deg);border-radius:${ref.id === "play" ? "80px" : "3px"};box-shadow:18px 22px 0 ${c.foreground}15}.two{position:absolute;background:${c.foreground};width:90px;height:110px;right:15px;top:25px;opacity:.8;transform:rotate(12deg);border-radius:${serif ? "50%" : "12px"}}.line{position:absolute;left:60px;top:130px;width:115px;border-top:1px solid ${c.background};transform:rotate(-12deg)}footer{display:flex;gap:30px;border-top:1px solid ${c.foreground}33;padding-top:24px;font:10px Arial}.mini{flex:1}b{display:block;font-size:17px;margin-bottom:10px}</style><header><strong>${serif ? "atelier." : "FORM /"}</strong><span>ABOUT &nbsp;&nbsp; WORKS &nbsp;&nbsp; CONTACT</span></header><main><div><small>GOOD THINGS, THOUGHTFULLY MADE.</small><h1>${dark ? "Make room<br>for better." : serif ? "A little more<br>meaningful." : "Find your<br>next chapter."}</h1><p>${e(ref.why)}</p><span class="button">Explore our work ↗</span></div><div class="art"><div class="one"></div><div class="two"></div><div class="line"></div></div></main><footer><div class="mini"><b>01 / Discover</b>Things that matter.</div><div class="mini"><b>02 / Create</b>Made with intention.</div><div class="mini"><b>03 / Connect</b>Start a conversation.</div></footer></html>`;
}
export function demoData() {
  const root = "https://komorebi.example.com/";
  const home = extractPage(
    `<html><head><title>こもれび設計室｜暮らしに、余白を。</title><meta name="description" content="こもれび設計室は、住まいと小さなお店の設計を手がける架空の設計事務所です。"></head><body><h1>暮らしに、余白を。</h1><p>こもれび設計室は、住まいと小さなお店の設計を手がける設計事務所です。</p><h2>あなたらしさから、はじめる。</h2><p>好きな景色、いつもの過ごし方、これからのこと。暮らしの話を聞くところから、私たちの設計は始まります。</p><h2>できること</h2><p>住宅の新築・リノベーション、店舗の内装設計、空間に合わせた家具のご提案。</p><h2>大切にしていること</h2><p>素材の表情を生かすこと。自然の光を取り入れること。長く愛着を持てる場所にすること。</p><a href="/works/">私たちの仕事</a><a href="/about/">設計室について</a><a href="mailto:hello@komorebi.example.com">設計のご相談</a></body></html>`,
    root,
  );
  const sub = (slug, title, heading, copy) =>
    extractPage(
      `<html><head><title>${title}｜こもれび設計室</title><script type="application/ld+json">${JSON.stringify(
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { position: 1, name: "ホーム", item: root },
            { position: 2, name: title, item: root + slug + "/" },
          ],
        },
      )}</script></head><body><h1>${heading}</h1><p>${copy}</p><h2>まずはお話から</h2><p>計画の規模や時期が決まっていなくても、お気軽にご相談ください。</p><a href="/">ホーム</a><a href="mailto:hello@komorebi.example.com">設計のご相談</a></body></html>`,
      root + slug + "/",
    );
  const pages = [
    home,
    sub(
      "works",
      "私たちの仕事",
      "生活に寄り添う、空間づくり。",
      "住まいとお店。それぞれの場所で過ごす人を中心に、建物と暮らしを考えます。",
    ),
    sub(
      "about",
      "設計室について",
      "一緒に考える設計室。",
      "対話を重ねながら、建物が完成したあとの暮らしまで考えます。",
    ),
  ];
  return {
    mode: "demo",
    url: root,
    goal: "inquiry",
    status: "ready",
    inventory: {
      pages,
      errors: [],
      remaining: 0,
      discovered: 3,
      maxPages: 12,
      scope: "sample",
      limitations: [
        "架空の企業と参考デザインを使った体験です。実際の調査結果ではありません。",
        "提案のフォーム・決済は元サイトへのリンクで引き継ぎます。",
      ],
    },
    research: {
      company: {
        name: "こもれび設計室",
        summary:
          "住まいと小さなお店をつくる設計事務所。素材と光を大切にした空間づくりが特徴です。",
        industry: "建築・空間設計",
        audience: "自分らしい住まいや小さなお店をつくりたい人",
        positioning: [
          {
            text: "対話を重ねる設計姿勢が、比較時の判断材料になります。",
            kind: "hypothesis",
            sourceUrls: [],
          },
          {
            text: "実例から相談までの道筋を短くすると、依頼を検討しやすくなる可能性があります。",
            kind: "hypothesis",
            sourceUrls: [],
          },
        ],
      },
      competitors: [
        {
          name: "暮らしのアトリエ（架空）",
          url: null,
          why: "住宅リノベーションという相談内容が共通。",
          sourceUrls: [],
          growth: {
            status: "unknown",
            metric: "成長データなし",
            periodFrom: "",
            periodTo: "",
            fromValue: null,
            toValue: null,
            unit: "",
            sourceUrls: [],
          },
        },
        {
          name: "余白工房（架空）",
          url: null,
          why: "素材や光を大切にした設計を提案。",
          sourceUrls: [],
          growth: {
            status: "unknown",
            metric: "成長データなし",
            periodFrom: "",
            periodTo: "",
            fromValue: null,
            toValue: null,
            unit: "",
            sourceUrls: [],
          },
        },
      ],
      references: demoReferences,
      recommendations: [
        {
          title: "最初の画面で、誰のための設計室か伝える",
          detail:
            "元の説明と見出しをまとめ、得意な仕事がすぐ分かる構成にします。",
          sourceUrls: [],
          priority: "high",
        },
        {
          title: "仕事紹介から相談へつなぐ",
          detail:
            "実例を見たあとに問い合わせ先へ進めるよう、既存リンクを保持して配置します。",
          sourceUrls: [],
          priority: "medium",
        },
        {
          title: "会社の説明を、読める情報として残す",
          detail:
            "見出し・本文・内部リンクを維持し、訪問者と検索エンジンが内容を理解しやすくします。",
          sourceUrls: [
            "https://developers.google.com/search/docs/appearance/ai-features",
          ],
          priority: "high",
        },
      ],
    },
    sources: [],
    usage: [],
  };
}
