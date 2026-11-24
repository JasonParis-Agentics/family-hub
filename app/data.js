// Family Hub — seed data. This is the ONE file you edit to make the hub yours.
// Anything a parent changes on the wall (Parents tab, PIN 1234) is saved to shared state (Worker KV) and
// overrides what's here — so after first boot, edit chores/rewards on the wall, not in this file.
(() => {
// helper: dates relative to today so the sample calendar never looks empty
const D = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const MON = (() => { const d = new Date(); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); })();

window.HUB_SEED = {
  familyName: "The Example Family",
  settings: { chimeGain: 2, pin: "1234", idleMinutes: 10, artMinutes: 3, quietStart: "19:30", quietEnd: "07:00", weekStartsOn: 1, sound: true, dayStart: 7, dayEnd: 21, sweepBonus: 20, calFilter: "family", sleepScreen: "verse", photoSeconds: 20,
    place: "Your Town, ST",  // weather label; set the coordinates in wrangler.jsonc vars
    plansUrl: "",            // optional embeddable page for a "Plans" tab (e.g. a 3D remodel model). Empty = tab hidden.
    familyGoal: { label: "Family pizza & movie night", points: 900 } },
  // Memory verse plan: each passage runs ~4 weekly parts (whole verses), then the whole passage on week 5; turns over Monday.
  // Parents → Verse can add more passages (needs the ESV_API_KEY Worker secret to fetch text + audio).
  verseSeries: [{"ref": "Ephesians 6:11–18", "start": "2026-11-23", "verses": [{"n": 11, "t": "Put on the whole armor of God, that you may be able to stand against the schemes of the devil."}, {"n": 12, "t": "For we do not wrestle against flesh and blood, but against the rulers, against the authorities, against the cosmic powers over this present darkness, against the spiritual forces of evil in the heavenly places."}, {"n": 13, "t": "Therefore take up the whole armor of God, that you may be able to withstand in the evil day, and having done all, to stand firm."}, {"n": 14, "t": "Stand therefore, having fastened on the belt of truth, and having put on the breastplate of righteousness,"}, {"n": 15, "t": "and, as shoes for your feet, having put on the readiness given by the gospel of peace."}, {"n": 16, "t": "In all circumstances take up the shield of faith, with which you can extinguish all the flaming darts of the evil one;"}, {"n": 17, "t": "and take the helmet of salvation, and the sword of the Spirit, which is the word of God,"}, {"n": 18, "t": "praying at all times in the Spirit, with all prayer and supplication. To that end, keep alert with all perseverance, making supplication for all the saints,"}], "parts": [[11, 12], [13, 14], [15, 16], [17, 18]]}, {"ref": "Matthew 5:3–12", "start": "2026-12-28", "verses": [{"n": 3, "t": "“Blessed are the poor in spirit, for theirs is the kingdom of heaven."}, {"n": 4, "t": "“Blessed are those who mourn, for they shall be comforted."}, {"n": 5, "t": "“Blessed are the meek, for they shall inherit the earth."}, {"n": 6, "t": "“Blessed are those who hunger and thirst for righteousness, for they shall be satisfied."}, {"n": 7, "t": "“Blessed are the merciful, for they shall receive mercy."}, {"n": 8, "t": "“Blessed are the pure in heart, for they shall see God."}, {"n": 9, "t": "“Blessed are the peacemakers, for they shall be called sons of God."}, {"n": 10, "t": "“Blessed are those who are persecuted for righteousness’ sake, for theirs is the kingdom of heaven."}, {"n": 11, "t": "“Blessed are you when others revile you and persecute you and utter all kinds of evil against you falsely on my account."}, {"n": 12, "t": "Rejoice and be glad, for your reward is great in heaven, for so they persecuted the prophets who were before you."}]}],
  verse: { ref: "Colossians 1:17", text: "And he is before all things, and in him all things hold together.", version: "ESV", pts: 15 },
  avatarChoices: ["🦊","🐯","🦁","🐼","🐨","🦄","🐉","🦖","🦕","🐢","🦋","🐝","🐙","🦈","🐬","🦅","🦉","🐺","🐻","🐸","🚀","🛸","⚡","🔥","🌈","⭐","🌙","🎸","🎨","⚽","🏀","🏈","⚾","🎯","🧩","🎮","🛹","🚲","🏹","🗡️","🛡️","👑","💎","🍕","🍩","🍉","🥑","🌵"],
  // id = lowercase, also used in wrangler.jsonc vars.KIDS so calendar events with the kid's name get tagged to them.
  // dob / investFrom / icon feed the Money tab (age-18 projection) — optional.
  kids: [
    { id: "ava",  name: "Ava",  color: "#f28c28", emoji: "🟠", goal: 340, startPoints: 0, icon: "🦄", dob: "2015-05-01" },
    { id: "ben",  name: "Ben",  color: "#3cb44b", emoji: "🟢", goal: 300, startPoints: 0, icon: "🦖", dob: "2017-08-12" },
    { id: "cleo", name: "Cleo", color: "#e8559a", emoji: "🩷", goal: 200, startPoints: 0, icon: "🦊", dob: "2020-02-20" }
  ],
  // kind: base = must ALL be done before the rest unlock · daily = extra, capPerDay · weekly = perWeek times a week (default 1)
  // ungated: true = tappable any time, even before base chores are done
  chores: {
    ava: [
      { id: "bed",     label: "Make your bed",    kind: "base",   pts: 10, icon: "🛏️" },
      { id: "school",  label: "School",           kind: "base",   pts: 20, icon: "📚", detail: "Reading · Writing · Math" },
      { id: "homefun", label: "Practice instrument", kind: "base", pts: 10, icon: "🎵" },
      { id: "sweep",   label: "Sweep floors",     kind: "daily",  pts: 5,  icon: "🧹", capPerDay: 1 },
      { id: "filldw",  label: "Fill dishwasher",  kind: "daily",  pts: 5,  icon: "🍽️", capPerDay: 1 },
      { id: "emptydw", label: "Empty dishwasher", kind: "daily",  pts: 5,  icon: "🫧", capPerDay: 1 },
      { id: "bedroom", label: "Clean bedroom",    kind: "daily",  pts: 10, icon: "🧺", capPerDay: 1 },
      { id: "bath",    label: "Clean bathroom",   kind: "weekly", pts: 20, icon: "🛁" },
      { id: "sport",   label: "Practice",         kind: "weekly", pts: 10, icon: "🥷", perWeek: 3 },
      { id: "shower",  label: "Shower",           kind: "weekly", pts: 5,  icon: "🚿", ungated: true },
      { id: "verse",   label: "Memory verse",     kind: "daily",  pts: 15, icon: "📖", capPerDay: 1, ungated: true }
    ],
    ben: [
      { id: "bed",     label: "Make your bed",    kind: "base",   pts: 10, icon: "🛏️" },
      { id: "school",  label: "School",           kind: "base",   pts: 20, icon: "📚", detail: "Reading · Writing · Math" },
      { id: "garbage", label: "Kitchen garbage",  kind: "daily",  pts: 5,  icon: "🗑️", capPerDay: 1, ungated: true },
      { id: "outside", label: "Pick up outside",  kind: "daily",  pts: 5,  icon: "🚲", capPerDay: 1 },
      { id: "bedroom", label: "Clean bedroom",    kind: "daily",  pts: 10, icon: "🧺", capPerDay: 1 },
      { id: "sport",   label: "Practice",         kind: "weekly", pts: 10, icon: "🥷", perWeek: 3 },
      { id: "verse",   label: "Memory verse",     kind: "daily",  pts: 15, icon: "📖", capPerDay: 1, ungated: true }
    ],
    cleo: [
      { id: "bed",     label: "Make your bed",    kind: "base",   pts: 5,  icon: "🛏️", detail: "with help" },
      { id: "toys",    label: "Pick up toys",     kind: "base",   pts: 5,  icon: "🧸" },
      { id: "fish",    label: "Feed fish",        kind: "daily",  pts: 5,  icon: "🐟", capPerDay: 1, ungated: true },
      { id: "shoes",   label: "Shoes and coats",  kind: "daily",  pts: 5,  icon: "👟", capPerDay: 1 },
      { id: "table",   label: "Clear table",      kind: "daily",  pts: 5,  icon: "🍽️", capPerDay: 1 },
      { id: "bathw",   label: "Bath",             kind: "weekly", pts: 5,  icon: "🛁", ungated: true },
      { id: "verse",   label: "Memory verse",     kind: "daily",  pts: 15, icon: "📖", capPerDay: 1, ungated: true }
    ]
  },
  // Money tab — filled in Parents → Money; nothing seeded on purpose
  money: { goals: [], budget: [], invest: {} },
  // add kids: ["ava"] to a reward to limit it to specific kids
  rewards: [
    { id: "movie",   label: "Friday movie pick",   cost: 100, icon: "🍿" },
    { id: "slushie", label: "Slushie run",         cost: 60,  icon: "🥤" },
    { id: "late",    label: "Stay up 30 min late", cost: 80,  icon: "🌙" },
    { id: "audible", label: "Audiobook credit",    cost: 120, icon: "🎧" },
    { id: "datedad", label: "Date with Dad",       cost: 300, icon: "🏃" },
    { id: "datemom", label: "Date with Mom",       cost: 300, icon: "🌷" },
    { id: "bonfire", label: "Marshmallow bonfire", cost: 160, icon: "🔥" },
    { id: "game",    label: "New game",            cost: 400, icon: "🎮" }
  ],
  schoolToday: { ava: "Reading ch. 7 · Writing journal · Math lesson 12", ben: "Reading 20 min · Copywork · Math lesson 9", cleo: "Story time" },
  // Meal plan: ISO date → dinner. Real plans come from data/meals.json (scripts/fetch_plan_to_eat.py) if you use Plan to Eat.
  meals: { [D(0)]: "Sheet-pan chicken & veggies", [D(1)]: "Taco night", [D(2)]: "Spaghetti & meatballs", [D(3)]: "Breakfast for dinner" },
  // Sample events so the calendar isn't empty. Once CAL_FEEDS is set on the Worker, live events replace these
  // (anything with source:"manual" stays). kind: family | school | kid (with kids:[ids]) | jason (parent work) | travel | vacation
  events: [
    { date: D(0), time: "16:30", end: "17:30", title: "Ava & Ben practice", kind: "kid", kids: ["ava","ben"], source: "manual" },
    { date: D(1), time: "18:00", end: "20:00", title: "Small group", kind: "family", source: "manual" },
    { date: D(2), time: "10:00", end: "11:00", title: "Cleo dentist", kind: "kid", kids: ["cleo"], source: "manual" },
    { date: D(3), time: "09:00", end: "17:00", title: "Dad · work offsite", kind: "jason", source: "manual" },
    { date: D(5), time: "09:30", end: "11:00", title: "Church", kind: "family", source: "manual" }
  ],
  // Year-view bands. endDate is exclusive (Google style). category: vacation | travel
  highlights: [
    { date: D(30), endDate: D(37), title: "Family vacation", category: "vacation", source: "manual" }
  ],
  // month-day, recurs every year
  birthdays: [
    { md: "05-01", who: "Ava", kid: "ava" },
    { md: "08-12", who: "Ben", kid: "ben" },
    { md: "02-20", who: "Cleo", kid: "cleo" }
  ]
};
})();
