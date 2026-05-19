# Playwright Demo Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six self-contained HTML demo files with Playwright scripts that record MP4 videos demonstrating the platform for organiser, artist, and public personas.

**Architecture:** Each demo is an independent HTML file (all CSS/JS inline, no server needed) opened via `file://` by a Playwright script. Scripts perform paced human-feeling interactions while Playwright records video. A shell script finds all recorded `.webm` files and converts them to MP4 via ffmpeg.

**Tech Stack:** `@playwright/test` 1.45+, TypeScript, Node.js, ffmpeg (must be installed separately via `brew install ffmpeg`)

**Reference file:** All CSS design tokens, component classes, and ARTISTS/CPF_QUESTIONS data live in `cpf_demo.html`. Copy from there; don't reinvent.

**Build order (by priority):** 04 → 03 → 01 → 06 → 02 → 05

---

### Task 0: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `playwright.config.ts`
- Create: `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "render-demos",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "demo": "playwright test",
    "demo:04": "playwright test playwright/demo-04-organiser-manage.ts",
    "demo:03": "playwright test playwright/demo-03-artist-apply.ts",
    "demo:01": "playwright test playwright/demo-01-public-visitor.ts",
    "demo:06": "playwright test playwright/demo-06-qr-moment.ts",
    "demo:02": "playwright test playwright/demo-02-artist-profile.ts",
    "demo:05": "playwright test playwright/demo-05-post-festival-trail.ts"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  testMatch: '**/*.ts',
  use: {
    headless: false,
    slowMo: 80,
    video: 'on',
  },
  outputDir: './output',
  reporter: 'list',
  workers: 1,
  timeout: 180000,
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["playwright/**/*.ts"]
}
```

- [ ] **Step 4: Update `.gitignore`** — add these lines (create the file if it doesn't exist):

```
output/
node_modules/
dist/
```

- [ ] **Step 5: Install and verify**

```bash
npm install && npx playwright install chromium
```

Expected: `node_modules/` created, Chromium downloaded. No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json playwright.config.ts tsconfig.json .gitignore
git commit -m "feat: scaffold Playwright demo project"
```

---

### Task 1: Shared Playwright helpers

**Files:**
- Create: `playwright/helpers.ts`

- [ ] **Step 1: Create `playwright/helpers.ts`**

```typescript
import { Page, Locator } from '@playwright/test';

export async function pause(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function slowType(locator: Locator, text: string, delayMs = 75): Promise<void> {
  await locator.click();
  await locator.pressSequentially(text, { delay: delayMs });
}

export async function scrollTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await pause(500);
}

export async function highlight(page: Page, selector: string, durationMs = 900): Promise<void> {
  await page.evaluate(
    ({ sel, dur }) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      const orig = el.style.outline;
      el.style.outline = '3px solid #E8A838';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = orig; el.style.outlineOffset = ''; }, dur);
    },
    { sel: selector, dur: durationMs }
  );
  await pause(durationMs + 200);
}
```

- [ ] **Step 2: Commit**

```bash
git add playwright/helpers.ts
git commit -m "feat: add Playwright demo helper utilities"
```

---

### Task 2: Demo 04 HTML — Organiser creating and managing

**File:** `demos/04-organiser-manage/index.html`

This is the most complex demo. It needs 8 screens not present in `cpf_demo.html`:
`s-org-empty`, `s-create-festival`, `s-form-builder`, `s-go-live-confirm`, `s-org-live`, `s-app-detail`, `s-decline-modal`, `s-bulk-confirm`.

- [ ] **Step 1: Create `demos/04-organiser-manage/index.html`**

Full file. Base CSS: copy the entire `<style>` block from `cpf_demo.html`. Add these new styles inside the same `<style>` tag:

```css
/* ── new for demo 04 ── */
.empty-state{text-align:center;padding:60px 24px}
.empty-state h2{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:300;color:var(--ink);margin-bottom:12px}
.empty-state p{font-size:13px;color:var(--mid);margin-bottom:28px;line-height:1.7}
.btn-primary{background:var(--amber);color:var(--ink);border:none;border-radius:4px;padding:12px 24px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;cursor:pointer}
.btn-secondary{background:none;color:var(--ink);border:1px solid var(--light);border-radius:4px;padding:12px 24px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;cursor:pointer}
.form-field{margin-bottom:20px}
.form-field label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mid);display:block;margin-bottom:6px}
.form-field input,.form-field textarea{width:100%;background:white;border:1px solid var(--light);border-radius:4px;padding:10px 14px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);outline:none}
.form-field input:focus,.form-field textarea:focus{border-color:var(--amber)}
.form-field textarea{min-height:80px;resize:vertical}
.question-item{background:white;border:1px solid var(--light);border-radius:6px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px}
.drag-handle{font-size:18px;color:var(--light);cursor:grab;flex-shrink:0;margin-top:2px}
.question-item.highlight-q{border-color:var(--amber);background:rgba(232,168,56,0.05)}
.new-question-row{background:var(--warm);border:1px dashed var(--light);border-radius:6px;padding:14px 16px;margin-bottom:8px;display:flex;gap:10px}
.new-question-row input{flex:1;background:white;border:1px solid var(--light);border-radius:4px;padding:8px 12px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none}
.new-question-row input:focus{border-color:var(--amber)}
.modal-overlay{position:fixed;inset:0;background:rgba(26,26,46,0.7);display:flex;align-items:center;justify-content:center;z-index:900}
.modal{background:white;border-radius:8px;padding:28px;max-width:440px;width:90%}
.modal h3{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--ink);margin-bottom:8px}
.modal p{font-size:13px;color:var(--mid);margin-bottom:20px;line-height:1.6}
.modal textarea{width:100%;background:var(--warm);border:1px solid var(--light);border-radius:4px;padding:10px 14px;font-family:'DM Sans',sans-serif;font-size:12px;min-height:80px;outline:none;margin-bottom:16px}
.modal textarea:focus{border-color:var(--amber)}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
.app-detail-section{padding:20px 24px}
.app-detail-section h3{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;margin-bottom:14px}
.portfolio-links a{display:block;font-family:'DM Mono',monospace;font-size:10px;color:var(--amber);letter-spacing:1px;margin-bottom:6px;text-decoration:none}
.live-badge-animated{animation:pulse 1.5s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
.counter-animate{transition:all 0.3s ease}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--offwhite);padding:12px 20px;border-radius:6px;font-size:12px;z-index:999;animation:slideUp 0.3s ease}
@keyframes slideUp{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:16px;background:var(--warm);border-radius:6px;margin-bottom:16px}
.toggle{width:48px;height:26px;background:var(--light);border-radius:13px;position:relative;cursor:pointer;transition:background 0.2s}
.toggle.on{background:var(--green)}
.toggle::after{content:'';position:absolute;width:20px;height:20px;background:white;border-radius:50%;top:3px;left:3px;transition:left 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.2)}
.toggle.on::after{left:25px}
```

HTML body structure (screens in order, each `display:none` except `s-org-empty` which is `display:block`):

```html
<body>
<nav class="app-nav" id="appNav">
  <button class="nav-back" id="backBtn" style="opacity:0;pointer-events:none">← Back</button>
  <div class="nav-logo">[ Platform <span>Name</span> ]</div>
  <div class="nav-right" id="navRight">Organiser</div>
</nav>

<!-- SCREEN: Empty 2027 state -->
<div id="s-org-empty" class="screen active">
  <div class="org-header">
    <span class="lbl" style="color:var(--amber)">Organiser Dashboard</span>
    <div class="org-fest-name">Cheltenham Paint Festival</div>
    <div class="org-meta">2026 complete · Ready to set up 2027</div>
  </div>
  <div class="empty-state">
    <span class="lbl" style="color:var(--clay);text-align:center;display:block">2027 Season</span>
    <h2>Ready to open<br>applications?</h2>
    <p>Set up your 2027 festival, build your application form, and go live when you're ready. Artists will be able to apply directly through the platform.</p>
    <button class="btn-primary create-festival-btn" onclick="showScreen('s-create-festival')">+ CREATE CPF 2027</button>
  </div>
</div>

<!-- SCREEN: Create festival form -->
<div id="s-create-festival" class="screen">
  <div class="org-header">
    <span class="lbl" style="color:var(--amber)">New Festival</span>
    <div class="org-fest-name">Create CPF 2027</div>
  </div>
  <div class="org-section">
    <div class="form-field">
      <label>Festival name</label>
      <input id="festival-name" type="text" placeholder="e.g. Cheltenham Paint Festival 2027">
    </div>
    <div class="form-field">
      <label>Dates</label>
      <input id="festival-dates" type="text" placeholder="e.g. 3–19 October 2027">
    </div>
    <div class="form-field">
      <label>Location</label>
      <input id="festival-location" type="text" placeholder="e.g. Cheltenham Town Centre, GL50">
    </div>
    <div class="form-field">
      <label>Description</label>
      <textarea id="festival-description" placeholder="A short description shown to artists browsing festivals…"></textarea>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn-secondary" onclick="showScreen('s-org-empty')">Cancel</button>
      <button class="btn-primary" id="next-form-builder-btn" onclick="showScreen('s-form-builder')">NEXT: BUILD FORM →</button>
    </div>
  </div>
</div>

<!-- SCREEN: Form builder -->
<div id="s-form-builder" class="screen">
  <div class="org-header">
    <span class="lbl" style="color:var(--amber)">Application Form</span>
    <div class="org-fest-name">CPF 2027 · Form Builder</div>
    <div class="org-meta">Carried forward from CPF 2026 · Drag to reorder · Add or remove questions</div>
  </div>
  <div class="org-section">
    <div class="form-questions-list" id="formQuestionsList"></div>
    <div class="new-question-row" id="newQuestionRow" style="display:none">
      <input id="new-question-input" placeholder="Type your new question…">
      <button class="btn-primary" id="save-question-btn" style="padding:8px 14px;font-size:9px" onclick="addNewQuestion()">ADD</button>
    </div>
    <button class="btn-secondary" id="add-question-btn" onclick="showNewQuestionRow()" style="margin-bottom:16px">+ ADD QUESTION</button>
    <div style="margin-top:8px">
      <button class="btn-primary" id="go-live-btn" onclick="showScreen('s-go-live-confirm')">REVIEW &amp; GO LIVE →</button>
    </div>
  </div>
</div>

<!-- SCREEN: Go live confirmation -->
<div id="s-go-live-confirm" class="screen">
  <div class="org-header">
    <span class="lbl" style="color:var(--amber)">Almost there</span>
    <div class="org-fest-name">Ready to go live?</div>
  </div>
  <div class="org-section">
    <div style="background:var(--warm);border-radius:8px;padding:20px;margin-bottom:20px">
      <p style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:300;line-height:1.6;color:var(--ink)">Once live, <em style="color:var(--clay)">Cheltenham Paint Festival 2027</em> will appear on the platform and artists can start applying.</p>
    </div>
    <div style="font-size:12px;color:var(--mid);line-height:1.7;margin-bottom:24px">
      <p>✓ Festival listing: Cheltenham Paint Festival 2027</p>
      <p>✓ Dates: 3–19 October 2027</p>
      <p>✓ Application form: 9 questions</p>
    </div>
    <div style="display:flex;gap:10px">
      <button class="btn-secondary" onclick="showScreen('s-form-builder')">← BACK</button>
      <button class="btn-primary" id="confirm-go-live-btn" onclick="goLive()">GO LIVE NOW</button>
    </div>
  </div>
</div>

<!-- SCREEN: Live dashboard with applications -->
<div id="s-org-live" class="screen">
  <div class="org-header">
    <span class="lbl" style="color:var(--green)">● LIVE · Applications Open</span>
    <div class="org-fest-name">Cheltenham Paint Festival 2027</div>
    <div class="org-meta">Applications open · Closing 28 February 2027</div>
    <div class="org-stats">
      <div class="org-stat"><div class="on" id="stat-total">0</div><div class="ol">Applications</div></div>
      <div class="org-stat"><div class="on" id="stat-accepted-live">0</div><div class="ol">Accepted</div></div>
      <div class="org-stat"><div class="on" id="stat-pending">0</div><div class="ol">Pending</div></div>
      <div class="org-stat"><div class="on">12</div><div class="ol">Slots left</div></div>
    </div>
  </div>
  <div class="org-section application-list">
    <div class="org-section-title">Applications</div>
    <div class="app-item accepted">
      <img class="app-avatar" src="https://picsum.photos/seed/rosa/80/80" alt="">
      <div class="app-info"><div class="app-name">Rosa Vane</div><div class="app-detail">Large-scale figural · Bristol · CPF 2024, 2025</div></div>
      <span class="app-status accepted">ACCEPTED</span>
      <div class="app-actions"><button class="btn-profile" onclick="showArtistDetail('rosa')">VIEW</button></div>
    </div>
    <div class="app-item" id="app-kit-live" style="border-color:var(--amber)">
      <img class="app-avatar" src="https://picsum.photos/seed/kit/80/80" alt="">
      <div class="app-info"><div class="app-name">Kit Harrow</div><div class="app-detail">Typography &amp; text · Cheltenham · CPF 2025</div></div>
      <span class="app-status pending">PENDING</span>
      <div class="app-actions">
        <button class="btn-profile btn-view-detail" onclick="showAppDetail('kit')">REVIEW</button>
      </div>
    </div>
    <div class="app-item" id="app-tomas-live">
      <img class="app-avatar" src="https://picsum.photos/seed/tomas/80/80" alt="">
      <div class="app-info"><div class="app-name">Tomás Cruz</div><div class="app-detail">Community portraiture · Cardiff · Meeting of Styles 2025</div></div>
      <span class="app-status pending">PENDING</span>
      <div class="app-actions">
        <button class="btn-profile btn-view-detail" onclick="showAppDetail('tomas')">REVIEW</button>
      </div>
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--light)">
      <button class="btn-secondary" id="bulk-reminder-btn" onclick="showBulkConfirm()">✉ SEND UPDATE TO 2 PENDING</button>
    </div>
  </div>
</div>

<!-- SCREEN: Application detail -->
<div id="s-app-detail" class="screen">
  <div class="org-header" id="app-detail-header">
    <span class="lbl" style="color:var(--amber)">Application Review</span>
    <div class="org-fest-name" id="app-detail-name"></div>
    <div class="org-meta" id="app-detail-meta"></div>
  </div>
  <div class="app-detail-section">
    <h3>Proposed work</h3>
    <div class="proposed-work" style="font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:300;line-height:1.65;color:var(--ink);margin-bottom:24px" id="app-detail-proposed"></div>
    <h3>Wall size</h3>
    <p style="font-size:13px;margin-bottom:20px" id="app-detail-wall"></p>
    <h3>Portfolio</h3>
    <div class="portfolio-links" id="app-detail-portfolio"></div>
    <div style="display:flex;gap:10px;margin-top:24px">
      <button class="btn-secondary" onclick="showScreen('s-org-live')">← BACK</button>
      <button class="btn-primary btn-accept-from-detail" onclick="acceptFromDetail()">ACCEPT</button>
      <button class="btn-secondary btn-decline-from-detail" onclick="showDeclineModal()" style="border-color:var(--red);color:var(--red)">DECLINE</button>
    </div>
  </div>
</div>

<!-- MODAL: Decline with message -->
<div id="decline-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <h3>Decline with a note</h3>
    <p>This message will be sent to the artist alongside the decision.</p>
    <textarea id="decline-message" placeholder="Thank you for applying…"></textarea>
    <div class="modal-btns">
      <button class="btn-secondary" onclick="closeDeclineModal()">Cancel</button>
      <button class="btn-primary" id="send-decline-btn" onclick="sendDecline()">SEND DECLINE</button>
    </div>
  </div>
</div>

<!-- MODAL: Bulk confirm -->
<div id="bulk-modal" style="display:none" class="modal-overlay">
  <div class="modal">
    <h3>Send update to pending artists</h3>
    <p>This will send an email to 2 artists still under review, letting them know their application is being considered.</p>
    <div class="modal-btns">
      <button class="btn-secondary" onclick="closeBulkModal()">Cancel</button>
      <button class="btn-primary" id="confirm-bulk-btn" onclick="sendBulk()">SEND UPDATE</button>
    </div>
  </div>
</div>
```

JavaScript — add inside `<script>` at bottom of body:

```javascript
const CPF_QUESTIONS = [
  {q:'Describe the work you are proposing for CPF 2027.',type:'Long text'},
  {q:'What size of wall do you require? (Approximate metres W × H)',type:'Short text'},
  {q:'Have you worked on outdoor murals at this scale before?',type:'Yes / No'},
  {q:'Please provide links to three examples of your recent work.',type:'URLs'},
  {q:'Do you have public liability insurance?',type:'Yes / No'},
  {q:'What is your preferred medium?',type:'Multiple choice · Spray / Brush / Mixed'},
  {q:'Are you available for the full festival period (3–19 Oct)?',type:'Yes / No / Partial'},
  {q:'Is there anything else the selection panel should know?',type:'Long text · Optional'},
];

const APP_DATA = {
  kit: {
    name:'Kit Harrow', meta:'Typography & text · Cheltenham-based · CPF 2025 alumni',
    proposed:'A piece built entirely from words that already exist on this building — <em>found text, amplified</em>. Planning permissions, planning notices, decades of civic language, reconfigured into something that feels inevitable.',
    wall:'12m W × 8m H',
    portfolio:['kharrow.co.uk/work/cheltenham-college','kharrow.co.uk/work/oxford-street-2024','instagram.com/kit.harrow'],
  },
  tomas: {
    name:'Tomás Cruz', meta:'Community portraiture · Cardiff-based · Meeting of Styles 2025',
    proposed:'A large-scale portrait of five Cheltenham residents identified through community engagement over the preceding months. Each subject painted at 1:1 scale, seated together on a shared wall.',
    wall:'20m W × 10m H',
    portfolio:['tomascruz.co.uk/community','tomascruz.co.uk/bath-road-2024','instagram.com/tomas.cruz.art'],
  },
};

let currentAppId = null;

// Screen nav
let screenHistory = ['s-org-empty'];
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
  window.scrollTo(0,0);
  if(screenHistory[screenHistory.length-1]!==id) screenHistory.push(id);
  const backBtn=document.getElementById('backBtn');
  if(backBtn) backBtn.style.opacity=screenHistory.length>1?'1':'0';
}

// Form builder
function buildFormQuestions(){
  const list=document.getElementById('formQuestionsList');
  if(!list||list.children.length>0) return;
  list.innerHTML=CPF_QUESTIONS.map((q,i)=>`
    <div class="question-item">
      <span class="drag-handle">⠿</span>
      <div style="flex:1">
        <p style="font-size:13px;color:var(--ink);margin-bottom:4px;font-weight:500">${q.q}</p>
        <span style="font-family:'DM Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:var(--mid)">${q.type}</span>
      </div>
      <span style="font-size:12px;color:var(--mid);cursor:pointer">✕</span>
    </div>`).join('');
}

function showNewQuestionRow(){
  document.getElementById('newQuestionRow').style.display='flex';
  document.getElementById('add-question-btn').style.display='none';
  document.getElementById('new-question-input').focus();
}

function addNewQuestion(){
  const input=document.getElementById('new-question-input');
  const list=document.getElementById('formQuestionsList');
  const n=list.children.length+1;
  const div=document.createElement('div');
  div.className='question-item highlight-q';
  div.innerHTML=`<span class="drag-handle">⠿</span><div style="flex:1"><p style="font-size:13px;color:var(--ink);margin-bottom:4px;font-weight:500">${input.value}</p><span style="font-family:'DM Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:var(--mid)">Short text</span></div>`;
  list.appendChild(div);
  document.getElementById('newQuestionRow').style.display='none';
  document.getElementById('add-question-btn').style.display='block';
}

// Go live + counter animation
function goLive(){
  showScreen('s-org-live');
  let t=0, p=0;
  const total=document.getElementById('stat-total');
  const pending=document.getElementById('stat-pending');
  const timer=setInterval(()=>{
    t=Math.min(t+1,3);
    p=Math.min(p+1,2);
    total.textContent=t;
    pending.textContent=p;
    if(t>=3) clearInterval(timer);
  },600);
}

// App detail
function showAppDetail(id){
  currentAppId=id;
  const d=APP_DATA[id];
  document.getElementById('app-detail-name').textContent=d.name;
  document.getElementById('app-detail-meta').textContent=d.meta;
  document.getElementById('app-detail-proposed').innerHTML=d.proposed;
  document.getElementById('app-detail-wall').textContent=d.wall;
  document.getElementById('app-detail-portfolio').innerHTML=d.portfolio.map(l=>`<a href="#">${l}</a>`).join('');
  showScreen('s-app-detail');
}

function acceptFromDetail(){
  const id=currentAppId;
  const item=document.getElementById('app-'+id+'-live');
  if(item){
    item.querySelector('.app-status').textContent='ACCEPTED';
    item.querySelector('.app-status').className='app-status accepted';
    item.classList.add('accepted');
    item.querySelector('.app-actions').innerHTML='<button class="btn-profile">VIEW</button>';
    const acc=document.getElementById('stat-accepted-live');
    acc.textContent=parseInt(acc.textContent||'0')+1;
    const pend=document.getElementById('stat-pending');
    pend.textContent=Math.max(0,parseInt(pend.textContent||'0')-1);
  }
  showScreen('s-org-live');
  showToast('✓ '+APP_DATA[id].name+' accepted');
}

// Decline modal
function showDeclineModal(){ document.getElementById('decline-modal').style.display='flex'; }
function closeDeclineModal(){ document.getElementById('decline-modal').style.display='none'; }
function sendDecline(){
  const id=currentAppId;
  const item=document.getElementById('app-'+id+'-live');
  if(item){
    item.querySelector('.app-status').textContent='DECLINED';
    item.querySelector('.app-status').className='app-status declined';
    item.classList.add('declined');
    item.querySelector('.app-actions').innerHTML='';
    const pend=document.getElementById('stat-pending');
    pend.textContent=Math.max(0,parseInt(pend.textContent||'0')-1);
  }
  closeDeclineModal();
  showScreen('s-org-live');
  showToast('Decline sent to '+APP_DATA[id].name);
}

// Bulk modal
function showBulkConfirm(){ document.getElementById('bulk-modal').style.display='flex'; }
function closeBulkModal(){ document.getElementById('bulk-modal').style.display='none'; }
function sendBulk(){
  closeBulkModal();
  showToast('✓ Update sent to 2 pending artists');
}

// Toast
function showToast(msg){
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

buildFormQuestions();
```

- [ ] **Step 2: Open in browser and verify all 8 screens render**

```bash
open demos/04-organiser-manage/index.html
```

Click through manually: Create Festival → Form Builder → Go Live → Live Dashboard → Review Kit → Accept → Review Tomás → Decline. Confirm all screens load and transitions work.

- [ ] **Step 3: Commit**

```bash
git add demos/04-organiser-manage/index.html
git commit -m "feat: add organiser manage demo HTML (8 screens)"
```

---

### Task 3: Demo 04 Playwright script

**File:** `playwright/demo-04-organiser-manage.ts`

- [ ] **Step 1: Create `playwright/demo-04-organiser-manage.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 04 — Organiser Creating and Managing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });

  const file = `file://${path.resolve(__dirname, '../demos/04-organiser-manage/index.html')}`;
  await page.goto(file);
  await expect(page.locator('#s-org-empty')).toBeVisible();
  await pause(2000);

  // Organiser sees empty 2027 state
  await scrollTo(page, '.empty-state');
  await pause(1500);
  await highlight(page, '.create-festival-btn');
  await page.click('.create-festival-btn');
  await pause(1000);

  // Create festival form
  await expect(page.locator('#festival-name')).toBeVisible();
  await pause(600);
  await slowType(page.locator('#festival-name'), 'Cheltenham Paint Festival 2027');
  await pause(400);
  await slowType(page.locator('#festival-dates'), '3–19 October 2027');
  await pause(400);
  await slowType(page.locator('#festival-location'), 'Cheltenham Town Centre, GL50');
  await pause(400);
  await slowType(page.locator('#festival-description'), 'The 11th edition of Cheltenham\'s flagship paint festival returns to transform the town\'s walls and buildings with large-scale public art.');
  await pause(1000);
  await highlight(page, '#next-form-builder-btn');
  await page.click('#next-form-builder-btn');
  await pause(1200);

  // Form builder — scroll to show all questions
  await expect(page.locator('.form-questions-list')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.form-questions-list');
  await pause(1000);
  await highlight(page, '.question-item:nth-child(3) .drag-handle');
  await pause(1200);

  // Add new question
  await scrollTo(page, '#add-question-btn');
  await highlight(page, '#add-question-btn');
  await page.click('#add-question-btn');
  await pause(600);
  await slowType(page.locator('#new-question-input'), 'What is your estimated budget for materials?');
  await pause(400);
  await page.click('#save-question-btn');
  await pause(1000);
  await scrollTo(page, '#go-live-btn');
  await highlight(page, '#go-live-btn');
  await page.click('#go-live-btn');
  await pause(1200);

  // Go live confirmation
  await expect(page.locator('#confirm-go-live-btn')).toBeVisible();
  await pause(2000);
  await highlight(page, '#confirm-go-live-btn');
  await page.click('#confirm-go-live-btn');
  await pause(2500); // counter animation

  // Live dashboard
  await expect(page.locator('#s-org-live')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.application-list');
  await pause(1500);

  // Review Kit's application
  await highlight(page, '#app-kit-live .btn-view-detail');
  await page.click('#app-kit-live .btn-view-detail');
  await pause(1000);

  await expect(page.locator('#app-detail-name')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.portfolio-links');
  await pause(1200);
  await scrollTo(page, '.proposed-work');
  await pause(1500);
  await scrollTo(page, '.btn-accept-from-detail');
  await pause(800);
  await highlight(page, '.btn-accept-from-detail');
  await page.click('.btn-accept-from-detail');
  await pause(1500);

  // Back on live dashboard — Kit accepted
  await pause(1000);
  await scrollTo(page, '#app-tomas-live');
  await highlight(page, '#app-tomas-live .btn-view-detail');
  await page.click('#app-tomas-live .btn-view-detail');
  await pause(1000);

  await expect(page.locator('#app-detail-name')).toBeVisible();
  await pause(1200);
  await highlight(page, '.btn-decline-from-detail');
  await page.click('.btn-decline-from-detail');
  await pause(800);

  // Decline modal
  await expect(page.locator('#decline-modal')).toBeVisible();
  await pause(800);
  await slowType(
    page.locator('#decline-message'),
    'Thank you for applying — we\'ve reached capacity for community portraiture this year. We hope to see you at CPF 2028.',
    65
  );
  await pause(800);
  await highlight(page, '#send-decline-btn');
  await page.click('#send-decline-btn');
  await pause(1500);

  // Bulk reminder
  await scrollTo(page, '#bulk-reminder-btn');
  await pause(800);
  await highlight(page, '#bulk-reminder-btn');
  await page.click('#bulk-reminder-btn');
  await pause(1000);
  await expect(page.locator('#bulk-modal')).toBeVisible();
  await pause(1500);
  await page.click('#confirm-bulk-btn');
  await pause(2000);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:04
```

Expected: Chromium opens, demo plays through all 8 screens, test passes. Video appears in `output/`. If any `expect` assertion fails, fix the selector in the HTML to match.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer demos/04-organiser-manage/index.html | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-04-organiser-manage.mp4
```

Expected: `output/demo-04-organiser-manage.mp4` created. Open and verify.

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-04-organiser-manage.ts
git commit -m "feat: add organiser manage Playwright script (demo 04)"
```

---

### Task 4: Demo 03 HTML — Artist applying to a festival

**File:** `demos/03-artist-apply/index.html`

Screens needed: `s-home`, `s-festival-open`, `s-apply-form`, `s-submitted`, `s-notifications`, `s-acceptance`.

- [ ] **Step 1: Create `demos/03-artist-apply/index.html`**

Base CSS: copy full `<style>` block from `cpf_demo.html`. Add these new styles:

```css
/* ── new for demo 03 ── */
.apply-hero{background:var(--ink);padding:28px 24px 24px;border-bottom:3px solid var(--amber)}
.apply-section{padding:24px}
.apply-section h2{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--ink);margin-bottom:20px}
.form-step{margin-bottom:24px}
.form-step label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mid);display:block;margin-bottom:6px}
.form-step input,.form-step textarea,.form-step select{width:100%;background:white;border:1px solid var(--light);border-radius:4px;padding:10px 14px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);outline:none;margin-bottom:4px}
.form-step input:focus,.form-step textarea:focus{border-color:var(--amber)}
.form-step textarea{min-height:90px;resize:vertical}
.form-step .hint{font-size:11px;color:var(--mid)}
.radio-row{display:flex;gap:10px;flex-wrap:wrap}
.radio-opt{background:var(--warm);border:1px solid var(--light);border-radius:4px;padding:8px 14px;font-size:12px;cursor:pointer;transition:border-color 0.15s,background 0.15s}
.radio-opt.selected{border-color:var(--amber);background:rgba(232,168,56,0.1);color:var(--ink)}
.submit-btn{width:100%;background:var(--amber);color:var(--ink);border:none;border-radius:4px;padding:14px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;cursor:pointer;margin-top:8px}
.submitted-hero{background:var(--ink);padding:48px 24px;text-align:center}
.submitted-icon{font-size:48px;margin-bottom:16px}
.submitted-hero h2{font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:300;color:var(--offwhite);margin-bottom:8px}
.submitted-hero p{font-size:13px;color:var(--mid);line-height:1.7}
.notif-item{background:white;border:1px solid var(--light);border-radius:6px;padding:14px 16px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s}
.notif-item.unread{border-color:var(--amber);border-left:4px solid var(--amber)}
.notif-item:hover{border-color:var(--amber)}
.notif-sender{font-family:'DM Mono',monospace;font-size:8.5px;letter-spacing:1.5px;color:var(--clay);margin-bottom:4px}
.notif-title{font-size:14px;font-weight:500;color:var(--ink);margin-bottom:2px}
.notif-preview{font-size:11px;color:var(--mid)}
.acceptance-card{background:white;border:1px solid var(--light);border-radius:8px;overflow:hidden;margin:24px}
.acceptance-card .ac-header{background:var(--ink);padding:20px;text-align:center}
.acceptance-card .ac-icon{font-size:36px;margin-bottom:8px}
.acceptance-card .ac-title{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:300;color:var(--offwhite)}
.acceptance-card .ac-body{padding:20px}
.acceptance-card .ac-body p{font-size:13px;color:#5A5A6A;line-height:1.7;margin-bottom:12px}
.acceptance-highlight{background:var(--warm);border-left:3px solid var(--amber);padding:12px 16px;border-radius:0 4px 4px 0;margin-bottom:16px}
.acceptance-highlight p{font-size:12px;color:var(--ink);font-weight:500;margin:0}
```

HTML body structure:

```html
<body>
<nav class="app-nav" id="appNav">
  <button class="nav-back" id="backBtn" onclick="goBack()" style="opacity:0;pointer-events:none;display:flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;color:var(--amber);font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px">← Back</button>
  <div class="nav-logo">[ Platform <span>Name</span> ]</div>
  <div class="nav-right" id="navRight">Demo</div>
</nav>

<!-- HOME -->
<div id="s-home" class="screen active">
  <div class="home-hero">
    <span class="lbl" style="color:var(--amber)">Paint Festival Platform</span>
    <div class="home-hero-title">[ Platform <em>Name</em> ]</div>
    <p class="home-sub">The home for paint festivals and the artists who make them.</p>
  </div>
  <div class="home-body">
    <p class="home-section-title">Coming <em>soon</em></p>
    <div class="fest-card" onclick="showScreen('s-festival-open')">
      <div class="fest-card-img" style="background:linear-gradient(135deg,var(--clay),var(--amber))">
        <div class="fest-card-img-inner" style="font-family:'Cormorant Garamond',serif;font-size:36px;color:rgba(255,255,255,0.25)">CPF 2027</div>
        <span class="live-badge" style="background:var(--green)">APPLICATIONS OPEN</span>
        <span class="year-badge">Cheltenham</span>
      </div>
      <div class="fest-card-body">
        <div class="fest-card-name">Cheltenham Paint Festival 2027</div>
        <div class="fest-card-meta">October 2027 · Cheltenham Town Centre · Applications close 28 Feb 2027</div>
        <div class="fest-card-desc">The 11th edition of Cheltenham's flagship paint festival. 12 artist slots. All mediums welcome. Walls across the town centre.</div>
        <div class="fest-card-footer">
          <span class="fest-card-stats">12 slots · Closes 28 Feb 2027</span>
          <button class="btn-view amber">APPLY NOW</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- FESTIVAL OPEN -->
<div id="s-festival-open" class="screen">
  <div class="apply-hero">
    <span class="lbl" style="color:var(--green)">● Applications Open</span>
    <div class="fest-name">Cheltenham<br>Paint Festival 2027</div>
    <div class="fest-meta-row">
      <span class="fest-meta-pill amber">CLOSES 28 FEB 2027</span>
      <span class="fest-meta-pill">October 2027</span>
      <span class="fest-meta-pill">Cheltenham, GL50</span>
    </div>
  </div>
  <div style="padding:20px 24px;background:var(--warm);border-bottom:1px solid var(--light)">
    <p style="font-size:13px;color:#5A5A6A;line-height:1.7;font-weight:300;margin-bottom:12px">The 11th edition of Cheltenham Paint Festival returns October 2027. 12 artist slots, walls across the town centre. All mediums. All scales. Local and international artists welcome.</p>
    <button class="btn-view amber" style="font-size:9px" onclick="showScreen('s-apply-form')">APPLY TO CPF 2027 →</button>
  </div>
  <div style="padding:20px 24px">
    <p class="home-section-title" style="margin-top:0">What we look for</p>
    <p style="font-size:13px;color:#5A5A6A;line-height:1.7">Large-scale ambition, site-specific thinking, community engagement. We welcome artists at all career stages — CPF has launched careers and it should keep doing that.</p>
  </div>
</div>

<!-- APPLICATION FORM -->
<div id="s-apply-form" class="screen">
  <div class="apply-hero">
    <span class="lbl" style="color:var(--amber)">Your Application</span>
    <div class="fest-name">CPF 2027</div>
  </div>
  <div class="apply-section">
    <div class="form-step">
      <label>Describe the work you are proposing</label>
      <textarea id="q-proposed" placeholder="Tell us about the piece you have in mind…"></textarea>
    </div>
    <div class="form-step">
      <label>Wall size required (W × H in metres)</label>
      <input id="q-wall" type="text" placeholder="e.g. 12m × 8m">
    </div>
    <div class="form-step">
      <label>Have you worked on outdoor murals at this scale before?</label>
      <div class="radio-row">
        <div class="radio-opt" id="rq-yes" onclick="selectRadio('rq','yes')">Yes</div>
        <div class="radio-opt" id="rq-no" onclick="selectRadio('rq','no')">No</div>
      </div>
    </div>
    <div class="form-step">
      <label>Three examples of your recent work (URLs)</label>
      <input id="q-p1" type="text" placeholder="kharrow.co.uk/cheltenham-college">
      <input id="q-p2" type="text" placeholder="kharrow.co.uk/oxford-street-2024">
      <input id="q-p3" type="text" placeholder="instagram.com/kit.harrow">
    </div>
    <div class="form-step">
      <label>Do you have public liability insurance?</label>
      <div class="radio-row">
        <div class="radio-opt" id="ri-yes" onclick="selectRadio('ri','yes')">Yes</div>
        <div class="radio-opt" id="ri-no" onclick="selectRadio('ri','no')">No</div>
      </div>
    </div>
    <div class="form-step">
      <label>Preferred medium</label>
      <div class="radio-row">
        <div class="radio-opt" id="rm-spray" onclick="selectRadio('rm','spray')">Spray</div>
        <div class="radio-opt" id="rm-brush" onclick="selectRadio('rm','brush')">Brush</div>
        <div class="radio-opt" id="rm-mixed" onclick="selectRadio('rm','mixed')">Mixed</div>
      </div>
    </div>
    <div class="form-step">
      <label>Are you available for the full festival period (3–19 October)?</label>
      <div class="radio-row">
        <div class="radio-opt" id="ra-full" onclick="selectRadio('ra','full')">Yes — full period</div>
        <div class="radio-opt" id="ra-partial" onclick="selectRadio('ra','partial')">Partial</div>
        <div class="radio-opt" id="ra-no" onclick="selectRadio('ra','no')">No</div>
      </div>
    </div>
    <div class="form-step">
      <label>Anything else the panel should know? <span class="hint">(Optional)</span></label>
      <textarea id="q-other" placeholder="Optional…"></textarea>
    </div>
    <button class="submit-btn" onclick="showScreen('s-submitted')">SUBMIT APPLICATION →</button>
  </div>
</div>

<!-- SUBMITTED -->
<div id="s-submitted" class="screen">
  <div class="submitted-hero">
    <div class="submitted-icon">✓</div>
    <h2>Application submitted</h2>
    <p>Thank you, Kit. We'll review your application and be in touch by March 2027. You'll get a notification here and by email.</p>
  </div>
  <div style="padding:24px">
    <p style="font-size:13px;color:var(--mid);margin-bottom:16px">While you wait, explore other artists on the platform or follow festivals you're interested in.</p>
    <button class="btn-view" style="font-size:9px" onclick="showScreen('s-notifications')">VIEW NOTIFICATIONS →</button>
  </div>
</div>

<!-- NOTIFICATIONS -->
<div id="s-notifications" class="screen">
  <div class="org-header" style="padding:20px 24px">
    <span class="lbl" style="color:var(--amber)">Notifications</span>
    <div class="org-fest-name" style="font-size:24px">Inbox</div>
  </div>
  <div style="padding:20px 24px">
    <div class="notif-item unread" onclick="showScreen('s-acceptance')">
      <div class="notif-sender">CHELTENHAM PAINT FESTIVAL 2027</div>
      <div class="notif-title">🎉 Your application has been accepted</div>
      <div class="notif-preview">Congratulations Kit — we're delighted to offer you a place at CPF 2027…</div>
    </div>
    <div class="notif-item" style="opacity:0.5">
      <div class="notif-sender">PLATFORM</div>
      <div class="notif-title">Application received — CPF 2027</div>
      <div class="notif-preview">We've received your application. You'll hear back by March 2027.</div>
    </div>
  </div>
</div>

<!-- ACCEPTANCE -->
<div id="s-acceptance" class="screen">
  <div class="acceptance-card">
    <div class="ac-header">
      <div class="ac-icon">🎉</div>
      <div class="ac-title">You're in, Kit.</div>
    </div>
    <div class="ac-body">
      <p>Congratulations — the CPF selection panel is delighted to offer you a place at <strong>Cheltenham Paint Festival 2027</strong>.</p>
      <div class="acceptance-highlight"><p>Festival dates: 3–19 October 2027</p></div>
      <div class="acceptance-highlight"><p>Your wall: to be confirmed. We'll be in touch by April 2027 with location details.</p></div>
      <p>Next steps: you'll receive an artist agreement by email. Please sign and return it within 14 days.</p>
      <button class="btn-view amber" style="width:100%;text-align:center;font-size:9px">VIEW FESTIVAL DETAILS →</button>
    </div>
  </div>
</div>
</body>
```

JavaScript:

```javascript
let screenHistory = ['s-home'];
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
  if(screenHistory[screenHistory.length-1]!==id) screenHistory.push(id);
  const back=document.getElementById('backBtn');
  if(back){ back.style.opacity=screenHistory.length>1?'1':'0'; back.style.pointerEvents=screenHistory.length>1?'all':'none'; }
}
function goBack(){
  if(screenHistory.length<=1) return;
  screenHistory.pop();
  showScreen(screenHistory[screenHistory.length-1]);
}
function selectRadio(group, val){
  document.querySelectorAll(`[id^="${group}-"]`).forEach(el=>el.classList.remove('selected'));
  document.getElementById(`${group}-${val}`)?.classList.add('selected');
}
```

- [ ] **Step 2: Open in browser and verify all 6 screens**

```bash
open demos/03-artist-apply/index.html
```

Click: home card → festival page → Apply → fill form → Submit → View Notifications → tap acceptance notification → acceptance message. Confirm all screens render correctly.

- [ ] **Step 3: Commit**

```bash
git add demos/03-artist-apply/index.html
git commit -m "feat: add artist apply demo HTML (6 screens)"
```

---

### Task 5: Demo 03 Playwright script

**File:** `playwright/demo-03-artist-apply.ts`

- [ ] **Step 1: Create `playwright/demo-03-artist-apply.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 03 — Artist Applying to a Festival', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/03-artist-apply/index.html')}`);
  await expect(page.locator('#s-home')).toBeVisible();
  await pause(1500);

  // Home — see CPF 2027 applications open
  await highlight(page, '.fest-card');
  await page.click('.fest-card');
  await pause(1000);

  // Festival page
  await expect(page.locator('#s-festival-open')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.btn-view.amber');
  await pause(800);
  await highlight(page, '.btn-view.amber');
  await page.click('.btn-view.amber');
  await pause(1000);

  // Application form
  await expect(page.locator('#s-apply-form')).toBeVisible();
  await pause(800);

  await slowType(
    page.locator('#q-proposed'),
    'A piece built entirely from words already on this building — planning notices, civic language, decades of text — reconfigured into something that feels inevitable.',
    60
  );
  await pause(500);

  await scrollTo(page, '#q-wall');
  await slowType(page.locator('#q-wall'), '12m × 8m');
  await pause(400);

  await scrollTo(page, '#rq-yes');
  await highlight(page, '#rq-yes');
  await page.click('#rq-yes');
  await pause(600);

  await scrollTo(page, '#q-p1');
  await slowType(page.locator('#q-p1'), 'kharrow.co.uk/cheltenham-college', 50);
  await pause(200);
  await slowType(page.locator('#q-p2'), 'kharrow.co.uk/oxford-street-2024', 50);
  await pause(200);
  await slowType(page.locator('#q-p3'), 'instagram.com/kit.harrow', 50);
  await pause(500);

  await scrollTo(page, '#ri-yes');
  await page.click('#ri-yes');
  await pause(500);

  await scrollTo(page, '#rm-spray');
  await highlight(page, '#rm-spray');
  await page.click('#rm-spray');
  await pause(500);

  await scrollTo(page, '#ra-full');
  await highlight(page, '#ra-full');
  await page.click('#ra-full');
  await pause(800);

  await scrollTo(page, '.submit-btn');
  await pause(800);
  await highlight(page, '.submit-btn');
  await page.click('.submit-btn');
  await pause(1500);

  // Submitted
  await expect(page.locator('#s-submitted')).toBeVisible();
  await pause(2000);

  // Fast-forward to notifications
  await highlight(page, 'button.btn-view');
  await page.click('button.btn-view');
  await pause(1000);

  await expect(page.locator('#s-notifications')).toBeVisible();
  await pause(1500);
  await highlight(page, '.notif-item.unread');
  await page.click('.notif-item.unread');
  await pause(1000);

  // Acceptance
  await expect(page.locator('#s-acceptance')).toBeVisible();
  await pause(3000);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:03
```

Expected: test passes, video recorded to `output/`. Watch the video — confirm typing is legible and pacing feels natural.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer playwright/demo-03-artist-apply.ts | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-03-artist-apply.mp4
```

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-03-artist-apply.ts
git commit -m "feat: add artist apply Playwright script (demo 03)"
```

---

### Task 6: Demo 01 HTML — Public visitor

**File:** `demos/01-public-visitor/index.html`

This demo reuses almost everything from `cpf_demo.html`. The only change: remove the "⚙ Organiser View" button from the festival header (public users don't see that).

- [ ] **Step 1: Create `demos/01-public-visitor/index.html`**

Copy `cpf_demo.html` entirely to `demos/01-public-visitor/index.html`. Then make one edit — remove this element from the festival archive header:

```html
<!-- DELETE this button from s-festival-archive's fest-header-top div: -->
<button class="btn-org-view" onclick="showScreen('s-organiser')">⚙ Organiser View</button>
```

That's it. The rest of the demo — home, festival archive, map, artist profiles — already works correctly.

- [ ] **Step 2: Verify in browser**

```bash
open demos/01-public-visitor/index.html
```

Confirm: home screen shows CPF 2026 archive card, clicking it shows map tab, clicking a map pin shows artist popup, clicking "View Profile" shows artist profile. Organiser button is absent.

- [ ] **Step 3: Commit**

```bash
git add demos/01-public-visitor/index.html
git commit -m "feat: add public visitor demo HTML (demo 01)"
```

---

### Task 7: Demo 01 Playwright script

**File:** `playwright/demo-01-public-visitor.ts`

- [ ] **Step 1: Create `playwright/demo-01-public-visitor.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 01 — Public Visitor at the Festival', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/01-public-visitor/index.html')}`);
  await expect(page.locator('#s-home')).toBeVisible();
  await pause(1500);

  // Home — see the CPF 2026 archive card
  await scrollTo(page, '.fest-card');
  await pause(1200);
  await highlight(page, '.fest-card:first-child');
  await page.click('.fest-card:first-child');
  await pause(1000);

  // Festival archive — map tab loads
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(2500); // map tiles load

  // Scroll so map is fully visible
  await scrollTo(page, '#fest-map');
  await pause(2000);

  // Click Amara's pin (marker index 2, the third marker added)
  // Markers are Leaflet divIcon elements — click by position near Amara's coords
  // Amara: lat 51.9009, lng -2.0783 — use page.mouse to click the map area
  const mapBox = await page.locator('#fest-map').boundingBox();
  if (mapBox) {
    // Click roughly centre-left of map where Amara's pin sits
    await page.mouse.move(mapBox.x + mapBox.width * 0.38, mapBox.y + mapBox.height * 0.45);
    await pause(400);
    await page.mouse.click(mapBox.x + mapBox.width * 0.38, mapBox.y + mapBox.height * 0.45);
    await pause(1500);
  }

  // If popup appeared, click VIEW PROFILE; if not, use the artists tab fallback
  const popupVisible = await page.locator('.popup-btn.view').isVisible().catch(() => false);
  if (popupVisible) {
    await highlight(page, '.popup-btn.view');
    await page.click('.popup-btn.view');
  } else {
    // Fallback: use Artists tab → click Amara
    await page.click('.fest-tab:nth-child(2)');
    await pause(800);
    await page.locator('.artist-row').nth(2).click();
  }
  await pause(1000);

  // Artist profile
  await expect(page.locator('#s-artist')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.analytics-row');
  await pause(1200);
  await scrollTo(page, '.artist-bio');
  await pause(1200);
  await scrollTo(page, '.gallery-grid');
  await pause(1500);
  await scrollTo(page, '.qr-section');
  await pause(2000);
  await scrollTo(page, '.socials-row');
  await pause(1000);
  await highlight(page, '.social-btn:first-child');
  await pause(1500);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:01
```

If the map pin click misses (Leaflet map positions vary by tile load timing), adjust the `mapBox.width * 0.38` / `mapBox.height * 0.45` multipliers until a pin is hit reliably. The fallback path via the Artists tab ensures the demo completes even if the pin click fails.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer playwright/demo-01-public-visitor.ts | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-01-public-visitor.mp4
```

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-01-public-visitor.ts
git commit -m "feat: add public visitor Playwright script (demo 01)"
```

---

### Task 8: Demo 06 HTML — The QR moment

**File:** `demos/06-qr-moment/index.html`

This demo opens directly to Amara Diallo's artist profile — no home screen, no navigation. Simulates landing from a QR code scan.

- [ ] **Step 1: Create `demos/06-qr-moment/index.html`**

Copy `cpf_demo.html`. Make these two changes:

1. Remove the nav back button and nav right label (replace nav with):

```html
<nav class="app-nav" id="appNav">
  <div style="width:80px"></div>
  <div class="nav-logo">[ Platform <span>Name</span> ]</div>
  <div class="nav-right">via QR</div>
</nav>
```

2. In the `<script>` block, after all function definitions, add this line to auto-load Amara's profile on page load (replace `buildArtistList()` with):

```javascript
buildArtistList();
showArtist('amara');
```

No other changes needed. The artist profile screen starts active.

- [ ] **Step 2: Verify in browser**

```bash
open demos/06-qr-moment/index.html
```

Expected: page opens directly to Amara's profile. No home screen visible. Nav shows "via QR".

- [ ] **Step 3: Commit**

```bash
git add demos/06-qr-moment/index.html
git commit -m "feat: add QR moment demo HTML (demo 06)"
```

---

### Task 9: Demo 06 Playwright script

**File:** `playwright/demo-06-qr-moment.ts`

- [ ] **Step 1: Create `playwright/demo-06-qr-moment.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 06 — The QR Moment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/06-qr-moment/index.html')}`);
  await expect(page.locator('#s-artist')).toBeVisible();
  await pause(2000);

  // Artist profile opens cold — bio first
  await pause(1200);
  await scrollTo(page, '.analytics-row');
  await pause(1200);
  await scrollTo(page, '.artist-bio');
  await pause(2000);

  // Gallery
  await scrollTo(page, '.gallery-grid');
  await pause(2000);

  // Festival badge — this is where she exhibited
  await scrollTo(page, '.fest-badge');
  await pause(1500);

  // QR section — the heart of the demo
  await scrollTo(page, '.qr-section');
  await pause(3000);

  // Socials
  await scrollTo(page, '.socials-row');
  await pause(1000);
  await highlight(page, '.social-btn:first-child');
  await pause(2000);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:06
```

Expected: opens directly on Amara's profile, scrolls through bio/gallery/QR. ~60 seconds total. Verify the QR section gets a long pause — it's the centrepiece of this demo.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer playwright/demo-06-qr-moment.ts | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-06-qr-moment.mp4
```

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-06-qr-moment.ts
git commit -m "feat: add QR moment Playwright script (demo 06)"
```

---

### Task 10: Demo 02 HTML — Artist profile management

**File:** `demos/02-artist-profile/index.html`

New screens needed: `s-artist-dashboard` (Rosa, logged-in state with edit button), `s-edit-profile` (editable bio/fields).

- [ ] **Step 1: Create `demos/02-artist-profile/index.html`**

Copy full `cpf_demo.html`. Add these new styles to the `<style>` block:

```css
/* ── new for demo 02 ── */
.dashboard-header{background:var(--ink);padding:24px;border-bottom:3px solid var(--clay)}
.dashboard-label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--amber);margin-bottom:8px;display:block}
.edit-btn{background:none;border:1px solid rgba(232,168,56,0.4);color:var(--amber);border-radius:3px;padding:7px 14px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:1.5px;cursor:pointer;transition:background 0.15s}
.edit-btn:hover{background:rgba(232,168,56,0.1)}
.edit-field label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mid);display:block;margin-bottom:6px;margin-top:16px}
.edit-field textarea,.edit-field input{width:100%;background:white;border:1px solid var(--light);border-radius:4px;padding:10px 14px;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--ink);outline:none}
.edit-field textarea{min-height:100px;resize:vertical;font-family:'Cormorant Garamond',serif;font-size:16px;line-height:1.6}
.edit-field textarea:focus,.edit-field input:focus{border-color:var(--amber)}
.save-btn{background:var(--amber);color:var(--ink);border:none;border-radius:4px;padding:12px 24px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;cursor:pointer;margin-top:16px}
.qr-download-btn{background:var(--ink);color:var(--offwhite);border:none;border-radius:4px;padding:10px 18px;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;cursor:pointer;margin-top:12px;transition:background 0.15s}
.qr-download-btn:hover{background:var(--clay)}
.qr-download-btn.downloading{background:var(--green)}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--offwhite);padding:12px 20px;border-radius:6px;font-size:12px;z-index:999;animation:slideUp 0.3s ease}
@keyframes slideUp{from{transform:translateX(-50%) translateY(20px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
```

Add a new screen `s-artist-dashboard` before `s-artist` in the HTML — this is the logged-in view. Change the initial active screen to `s-artist-dashboard` by setting its class to `screen active` and `s-home` to `screen`:

```html
<!-- ARTIST DASHBOARD (logged in as Rosa Vane) -->
<div id="s-artist-dashboard" class="screen active">
  <div class="dashboard-header">
    <span class="dashboard-label">Your Profile</span>
    <div class="artist-name" style="font-size:clamp(28px,6vw,42px)">Rosa Vane</div>
    <div class="artist-medium-tag">Large-scale figural murals</div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="edit-btn" onclick="showScreen('s-edit-profile')">✎ EDIT PROFILE</button>
    </div>
  </div>
  <div class="artist-body">
    <div class="analytics-row">
      <div class="analytics-card"><div class="an">342</div><div class="al">Profile views</div></div>
      <div class="analytics-card"><div class="an">218</div><div class="al">QR scans</div></div>
      <div class="analytics-card"><div class="an">94</div><div class="al">Link clicks</div></div>
    </div>
    <p class="artist-bio">Rosa's monumental figures emerge from walls with a quiet intensity — <em>bodies in conversation with architecture</em>, never fighting it. Her practice spans Bristol, Berlin, and now Cheltenham, where her work on the Brewery Quarter wall stopped traffic on opening day.</p>
    <div class="gallery-grid">
      <img class="gallery-img main-img" src="https://picsum.photos/seed/rosam1/600/338" alt="Rosa Vane work">
      <img class="gallery-img" src="https://picsum.photos/seed/rosam2/300/225" alt="Rosa Vane work">
      <img class="gallery-img" src="https://picsum.photos/seed/rosam3/300/225" alt="Rosa Vane work">
    </div>
    <div class="fest-badge" onclick="showScreen('s-festival-archive')">
      <div class="fest-badge-left">
        <div class="badge-label">Appearing at</div>
        <div class="badge-name">Cheltenham Paint Festival 2026</div>
      </div>
      <div class="fest-badge-right">→</div>
    </div>
    <div class="qr-section">
      <svg width="64" height="64" viewBox="0 0 64 64" style="flex-shrink:0">
        <rect width="64" height="64" rx="6" fill="#FAF7F2"/>
        <rect x="4" y="4" width="24" height="24" rx="2" fill="#1A1A2E"/>
        <rect x="7" y="7" width="18" height="18" rx="1" fill="#FAF7F2"/>
        <rect x="10" y="10" width="12" height="12" rx="1" fill="#1A1A2E"/>
        <rect x="36" y="4" width="24" height="24" rx="2" fill="#1A1A2E"/>
        <rect x="39" y="7" width="18" height="18" rx="1" fill="#FAF7F2"/>
        <rect x="42" y="10" width="12" height="12" rx="1" fill="#1A1A2E"/>
        <rect x="4" y="36" width="24" height="24" rx="2" fill="#1A1A2E"/>
        <rect x="7" y="39" width="18" height="18" rx="1" fill="#FAF7F2"/>
        <rect x="10" y="42" width="12" height="12" rx="1" fill="#1A1A2E"/>
        <rect x="36" y="36" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="43" y="36" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="50" y="36" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="36" y="43" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="50" y="43" width="5" height="5" rx="1" fill="#E8A838"/>
        <rect x="36" y="50" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="43" y="50" width="5" height="5" rx="1" fill="#1A1A2E"/>
        <rect x="50" y="50" width="5" height="5" rx="1" fill="#1A1A2E"/>
      </svg>
      <div class="qr-text">
        <h4>Your Branded QR Code</h4>
        <p>Print and display on your wall at any festival. Every scan goes directly to your profile.</p>
        <button class="qr-download-btn" id="qr-dl-btn" onclick="downloadQR()">↓ DOWNLOAD HIGH-RES PNG</button>
      </div>
    </div>
  </div>
</div>

<!-- EDIT PROFILE -->
<div id="s-edit-profile" class="screen">
  <div class="dashboard-header">
    <span class="dashboard-label">Edit Profile</span>
    <div class="artist-name" style="font-size:28px">Rosa Vane</div>
  </div>
  <div class="artist-body">
    <div class="edit-field">
      <label>Bio</label>
      <textarea id="edit-bio">Rosa's monumental figures emerge from walls with a quiet intensity — bodies in conversation with architecture, never fighting it. Her practice spans Bristol, Berlin, and now Cheltenham, where her work on the Brewery Quarter wall stopped traffic on opening day.</textarea>
    </div>
    <div class="edit-field">
      <label>Location</label>
      <input id="edit-location" type="text" value="Bristol, UK">
    </div>
    <div class="edit-field">
      <label>Medium</label>
      <input id="edit-medium" type="text" value="Large-scale figural murals">
    </div>
    <button class="save-btn" onclick="saveProfile()">SAVE CHANGES</button>
    <div style="margin-top:8px">
      <button class="edit-btn" onclick="showScreen('s-artist-dashboard')">Cancel</button>
    </div>
  </div>
</div>
```

Add to the JavaScript section (before closing `</script>`):

```javascript
function downloadQR(){
  const btn=document.getElementById('qr-dl-btn');
  btn.textContent='✓ DOWNLOADING…';
  btn.classList.add('downloading');
  setTimeout(()=>{
    btn.textContent='✓ SAVED TO DOWNLOADS';
  },1500);
}

function saveProfile(){
  const bio=document.getElementById('edit-bio').value;
  showScreen('s-artist-dashboard');
  // Update the displayed bio
  const bioEl=document.querySelector('#s-artist-dashboard .artist-bio');
  if(bioEl) bioEl.innerHTML=bio;
  showToast('✓ Profile saved');
}

function showToast(msg){
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}
```

- [ ] **Step 2: Verify in browser**

```bash
open demos/02-artist-profile/index.html
```

Confirm: opens on Rosa's dashboard with analytics, scroll to QR section, click Edit Profile → edit bio → Save → back to dashboard with updated bio and toast notification.

- [ ] **Step 3: Commit**

```bash
git add demos/02-artist-profile/index.html
git commit -m "feat: add artist profile management demo HTML (demo 02)"
```

---

### Task 11: Demo 02 Playwright script

**File:** `playwright/demo-02-artist-profile.ts`

- [ ] **Step 1: Create `playwright/demo-02-artist-profile.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, slowType, scrollTo, highlight } from './helpers';

test('Demo 02 — Artist Profile Management', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/02-artist-profile/index.html')}`);
  await expect(page.locator('#s-artist-dashboard')).toBeVisible();
  await pause(1500);

  // Dashboard — analytics
  await scrollTo(page, '.analytics-row');
  await pause(2000);

  // Scroll to QR section
  await scrollTo(page, '.qr-section');
  await pause(1500);
  await highlight(page, '#qr-dl-btn');
  await page.click('#qr-dl-btn');
  await pause(2500); // show download animation

  // Edit profile
  await scrollTo(page, '.edit-btn');
  await pause(800);
  await highlight(page, '.edit-btn');
  await page.click('.edit-btn');
  await pause(1000);

  await expect(page.locator('#s-edit-profile')).toBeVisible();
  await pause(800);

  // Clear bio and retype
  const bioField = page.locator('#edit-bio');
  await bioField.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await pause(400);
  await slowType(
    bioField,
    'Rosa\'s monumental figures emerge from walls with a quiet intensity — bodies in conversation with architecture, never fighting it. Bristol, Berlin, Cheltenham. Her practice follows the walls that deserve it.',
    55
  );
  await pause(800);

  await highlight(page, '.save-btn');
  await page.click('.save-btn');
  await pause(2000); // toast visible

  // Festival badge
  await scrollTo(page, '.fest-badge');
  await pause(1500);
  await highlight(page, '.fest-badge');
  await page.click('.fest-badge');
  await pause(1200);

  // Festival archive — end of demo
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(2000);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:02
```

Expected: demo opens on Rosa's dashboard, scrolls through analytics, downloads QR, edits bio, saves, ends on festival archive. ~2 minutes.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer playwright/demo-02-artist-profile.ts | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-02-artist-profile.mp4
```

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-02-artist-profile.ts
git commit -m "feat: add artist profile Playwright script (demo 02)"
```

---

### Task 12: Demo 05 HTML — Post-festival mural trail

**File:** `demos/05-post-festival-trail/index.html`

This demo is mostly `cpf_demo.html` but adds pin status (still there / removed) to the map and the legend.

- [ ] **Step 1: Create `demos/05-post-festival-trail/index.html`**

Copy `cpf_demo.html`. Remove the Organiser View button (same as Task 6 Step 1).

Modify `initFestMap()` in the `<script>` block. Replace the existing `initFestMap` function body with this version that adds status-based pin colours:

```javascript
const PIN_STATUS = {
  rosa: 'there', joel: 'there', amara: 'there',
  kit: 'removed', suki: 'there', tomas: 'removed'
};

function initFestMap(){
  if(festMap){ setTimeout(()=>festMap.invalidateSize(),100); return; }
  festMap = L.map('fest-map',{zoomControl:true}).setView([51.9000, -2.0790], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom:19
  }).addTo(festMap);

  Object.entries(ARTISTS).forEach(([id,a],i)=>{
    const status = PIN_STATUS[id] || 'there';
    const color = status === 'there' ? '#C45C3A' : '#8A8896';
    const label = status === 'there' ? '◆' : '○';
    const marker = L.marker([a.lat, a.lng], {icon: makeIcon(color, label)}).addTo(festMap);
    const statusBadge = status === 'there'
      ? '<span style="background:rgba(196,92,58,0.15);color:#C45C3A;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1.5px;padding:2px 7px;border-radius:2px">◆ STILL THERE</span>'
      : '<span style="background:rgba(138,136,150,0.15);color:#8A8896;font-family:\'DM Mono\',monospace;font-size:8px;letter-spacing:1.5px;padding:2px 7px;border-radius:2px">○ REMOVED</span>';
    marker.bindPopup(L.popup().setContent(`
      <div class="popup-inner">
        <div class="popup-artist-name">${a.name}</div>
        <div class="popup-medium">${a.medium}</div>
        <div style="margin-bottom:8px">${statusBadge}</div>
        <div class="popup-w3w">/// ${a.w3w}</div>
        <div class="popup-btns">
          <button class="popup-btn view" onclick="showArtist('${id}')">VIEW ARTIST</button>
          ${status==='there' ? `<button class="popup-btn nav-gmaps" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}','_blank')">NAVIGATE</button>` : ''}
        </div>
      </div>
    `), {maxWidth:260});
  });
}
```

Also update the legend strip below the map (replace existing legend div content):

```html
<div style="background:var(--warm);padding:10px 16px;border-bottom:1px solid var(--light);display:flex;align-items:center;gap:16px;flex-wrap:wrap">
  <span style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--clay)">◆ STILL THERE</span>
  <span style="font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mid)">○ REMOVED</span>
  <span style="font-size:11px;color:var(--mid);margin-left:auto">4 of 6 murals still visible</span>
</div>
```

- [ ] **Step 2: Verify in browser**

```bash
open demos/05-post-festival-trail/index.html
```

Click CPF 2026 archive → map tab. Confirm clay pins (Rosa, Joel, Amara, Suki) and grey pins (Kit, Tomás). Click a clay pin — popup shows "◆ STILL THERE" badge and Navigate button. Click a grey pin — shows "○ REMOVED", no navigate button.

- [ ] **Step 3: Commit**

```bash
git add demos/05-post-festival-trail/index.html
git commit -m "feat: add post-festival trail demo HTML with mural status pins (demo 05)"
```

---

### Task 13: Demo 05 Playwright script

**File:** `playwright/demo-05-post-festival-trail.ts`

- [ ] **Step 1: Create `playwright/demo-05-post-festival-trail.ts`**

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';
import { pause, scrollTo, highlight } from './helpers';

test('Demo 05 — Post-Festival Mural Trail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`file://${path.resolve(__dirname, '../demos/05-post-festival-trail/index.html')}`);
  await expect(page.locator('#s-home')).toBeVisible();
  await pause(1500);

  // Home — show archive card
  await scrollTo(page, '.fest-card:first-child');
  await pause(1200);
  await highlight(page, '.fest-card:first-child');
  await page.click('.fest-card:first-child');
  await pause(1000);

  // Festival archive — map tab
  await expect(page.locator('#s-festival-archive')).toBeVisible();
  await pause(2500); // map tiles load

  // Show the legend
  await scrollTo(page, '#fest-map');
  await pause(2500);

  // Click a "still there" pin (Rosa — top-right of map cluster)
  const mapBox = await page.locator('#fest-map').boundingBox();
  if (mapBox) {
    // Rosa: lat 51.8994, lng -2.0755 — right side of map
    await page.mouse.move(mapBox.x + mapBox.width * 0.60, mapBox.y + mapBox.height * 0.55);
    await pause(400);
    await page.mouse.click(mapBox.x + mapBox.width * 0.60, mapBox.y + mapBox.height * 0.55);
    await pause(1800);
  }

  // Popup visible — read it, then click artist profile
  const popupVisible = await page.locator('.popup-btn.view').isVisible().catch(() => false);
  if (popupVisible) {
    await pause(1500);
    await highlight(page, '.popup-btn.view');
    await page.click('.popup-btn.view');
  } else {
    // Fallback via Artists tab
    await page.click('.fest-tab:nth-child(2)');
    await pause(800);
    await page.locator('.artist-row').first().click();
  }
  await pause(1000);

  // Artist profile
  await expect(page.locator('#s-artist')).toBeVisible();
  await pause(1500);
  await scrollTo(page, '.fest-badge');
  await pause(2000);
  await scrollTo(page, '.artist-bio');
  await pause(1500);
});
```

- [ ] **Step 2: Run and verify**

```bash
npm run demo:05
```

Expected: home → archive map with status pins → popup showing "STILL THERE" badge → artist profile ending on festival badge. ~90 seconds.

- [ ] **Step 3: Convert to MP4**

```bash
find output -name "*.webm" -newer playwright/demo-05-post-festival-trail.ts | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/demo-05-post-festival-trail.mp4
```

- [ ] **Step 4: Commit**

```bash
git add playwright/demo-05-post-festival-trail.ts
git commit -m "feat: add post-festival trail Playwright script (demo 05)"
```

---

### Task 14: run-demos.sh and full pipeline

**File:** `run-demos.sh`

- [ ] **Step 1: Verify ffmpeg is installed**

```bash
ffmpeg -version
```

Expected: version string printed. If not installed: `brew install ffmpeg`.

- [ ] **Step 2: Create `run-demos.sh`**

```bash
#!/usr/bin/env bash
set -e

echo "=== Render Demo Video Pipeline ==="
echo ""

# Run all Playwright demos in priority order
DEMOS=(
  "demo:04"
  "demo:03"
  "demo:01"
  "demo:06"
  "demo:02"
  "demo:05"
)

for script in "${DEMOS[@]}"; do
  echo "▶ Running $script..."
  npm run "$script" || { echo "✗ $script failed"; exit 1; }
  echo "✓ $script complete"
  echo ""
done

echo "=== Converting webm → mp4 ==="
echo ""

# Find all webm files and convert
find output -name "*.webm" | while read -r webm; do
  # Extract demo number from path
  name=$(basename "$(dirname "$webm")")
  mp4="output/${name}.mp4"
  echo "Converting: $webm → $mp4"
  ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$mp4" -loglevel error
  echo "✓ $mp4"
done

echo ""
echo "=== Done ==="
ls -lh output/*.mp4 2>/dev/null || echo "No MP4s found — check output/ for webm files"
```

- [ ] **Step 3: Make executable and test with one demo**

```bash
chmod +x run-demos.sh
npm run demo:04
find output -name "*.webm" | head -1 | xargs -I{} ffmpeg -y -i {} -c:v libx264 -pix_fmt yuv420p -movflags +faststart output/test.mp4 -loglevel error && echo "Pipeline works" && rm output/test.mp4
```

Expected: `Pipeline works` printed. If ffmpeg errors, check the webm path.

- [ ] **Step 4: Run full pipeline**

```bash
./run-demos.sh
```

Expected: all 6 demos run in sequence, 6 MP4 files in `output/`. Open and spot-check each.

- [ ] **Step 5: Commit**

```bash
git add run-demos.sh
git commit -m "feat: add run-demos.sh full pipeline script"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Demo 01 — Public visitor | Task 6 (HTML), Task 7 (script) |
| Demo 02 — Artist profile management | Task 10 (HTML), Task 11 (script) |
| Demo 03 — Artist applying | Task 4 (HTML), Task 5 (script) |
| Demo 04 — Organiser creating/managing | Task 2 (HTML), Task 3 (script) |
| Demo 05 — Post-festival trail | Task 12 (HTML), Task 13 (script) |
| Demo 06 — QR moment | Task 8 (HTML), Task 9 (script) |
| Separate HTML per demo | ✓ each in `demos/XX-name/index.html` |
| MP4 output via ffmpeg | Task 14 |
| Mobile viewport (390×844) for demos 01,02,03,05,06 | ✓ set in each Playwright script |
| Desktop viewport (1024×768) for demo 04 | ✓ Task 3 |
| Shared helpers (pause, slowType, scrollTo, highlight) | Task 1 |
| Priority order: 04→03→01→06→02→05 | ✓ run-demos.sh, task ordering |

**Placeholder scan:** None found.

**Type consistency:** `showScreen`, `showToast`, `goBack`, `selectRadio`, `buildFormQuestions` — each defined exactly once in the file that uses it. `highlight(page, selector)`, `pause(ms)`, `slowType(locator, text, delay?)` — signatures consistent across all Playwright scripts.
