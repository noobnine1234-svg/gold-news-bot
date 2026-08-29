# กฎการแก้โค้ด / Code Editing Rules

> ไฟล์นี้ใช้สำหรับควบคุมพฤติกรรม AI เวลาแก้โค้ดในโปรเจกต์นี้ ป้องกันปัญหา "ยิ่งแก้ยิ่งพัง"
> This file governs AI behavior when editing code in this project — to prevent the "fix one thing, break three more" spiral.

---

## 1. ก่อนเริ่มแก้ / Before Starting

**ไทย**
- เช็ค `git status` ก่อนเสมอ — working tree ต้อง clean ถ้ายังไม่ clean ห้ามเริ่มแก้ ให้แจ้งผู้ใช้ก่อน
- สร้าง branch ใหม่ทุกครั้งก่อนแก้ ห้ามแก้บน `main`/`master` โดยตรง
  ```
  git checkout -b fix/<ชื่อปัญหา>
  ```
- อ่านและทำความเข้าใจโค้ดที่เกี่ยวข้องกับปัญหาให้ครบก่อนแก้ ห้ามเดา

**English**
- Always run `git status` first — the working tree must be clean. If it isn't, stop and tell the user before touching anything.
- Always create a new branch before editing. Never edit directly on `main`/`master`.
  ```
  git checkout -b fix/<issue-name>
  ```
- Read and understand the relevant code fully before editing. Don't guess.

---

## 2. ขอบเขตการแก้ไข / Scope of Changes

**ไทย**
- แก้เฉพาะโค้ดที่เกี่ยวข้องกับปัญหาระบุไว้เท่านั้น
- ห้าม refactor, ห้ามจัดโครงสร้างใหม่, ห้ามลบคอมเมนต์หรือโค้ดที่ไม่เกี่ยวข้อง โดยไม่ได้รับอนุญาตชัดเจน
- ถ้าเจอว่าต้องแก้ไฟล์อื่นเพิ่มนอกเหนือจากที่ระบุ ให้หยุดแล้วแจ้งก่อน ห้ามแก้เอง
- ก่อนแก้ ให้สรุปแผนสั้นๆ ว่าจะเปลี่ยนอะไร ไฟล์ไหน บรรทัดไหน แล้วรอการยืนยันถ้าเป็นการเปลี่ยนแปลงใหญ่

**English**
- Only touch code directly related to the reported issue.
- No refactoring, no restructuring, no deleting unrelated comments or code without explicit permission.
- If fixing the issue requires touching additional files not mentioned, stop and ask first — don't do it silently.
- Before large changes, summarize the plan (what/where) and wait for confirmation.

---

## 3. Commit บ่อยๆ เป็นก้อนเล็ก / Commit Small and Often

**ไทย**
- แก้เสร็จแต่ละจุด ให้ commit ทันที พร้อมข้อความอธิบายชัดเจนว่าแก้อะไร ทำไม
- ห้าม commit รวมหลายการแก้ไขที่ไม่เกี่ยวข้องกันไว้ใน commit เดียว
- ตัวอย่างข้อความ commit ที่ดี: `fix: null check ก่อนเรียก user.name ใน profile.js`

**English**
- Commit immediately after each fix, with a clear message explaining what and why.
- Never bundle unrelated changes into one commit.
- Good commit example: `fix: add null check before user.name in profile.js`

---

## 4. ตรวจสอบก่อนบอกว่า "เสร็จแล้ว" / Verify Before Declaring Done

**ไทย**
- รันเทส/build/lint ที่มีอยู่ก่อนสรุปว่าแก้เสร็จ (`npm test`, `npx tsc --noEmit` ทั้ง root และ `worker/`)
- แสดง `git diff` ให้เห็นการเปลี่ยนแปลงทั้งหมด ไม่ใช่แค่พูดลอยๆ ว่า "แก้แล้ว"
- ตรวจว่าฟีเจอร์เดิมที่เคยทำงานได้ ยังทำงานปกติอยู่ ไม่ใช่แค่ bug ที่ขอแก้หายไป

**English**
- Run existing tests/build/lint before claiming the fix is done (`npm test`, `npx tsc --noEmit` at root and in `worker/`).
- Show `git diff` for all changes — never just say "fixed it" without evidence.
- Confirm existing working features still work, not just that the reported bug is gone.

---

## 5. กฎที่สำคัญที่สุด: ห้ามแก้ซ้อนบนความพัง / Most Important Rule: Never Patch Over Breakage

**ไทย**
- ถ้าแก้แล้วเกิด error ใหม่ หรือแย่กว่าเดิม ให้ rollback ทันที ห้ามแก้ทับต่อ
  ```
  git checkout -- <file>       # ยกเลิกการแก้ไขไฟล์เดียว
  git reset --hard HEAD        # ยกเลิกทั้งหมด กลับจุดล่าสุด
  ```
- อนุญาตให้ลองแก้ปัญหาเดิมซ้ำได้ไม่เกิน 2 ครั้ง ถ้ายังไม่สำเร็จ ให้หยุด แล้วอธิบายว่าติดตรงไหน ห้ามลองมั่วต่อไปเรื่อยๆ
- ห้ามพยายาม "แก้ error ที่เกิดจากการแก้ error ก่อนหน้า" แบบไม่มีที่สิ้นสุด — นี่คือสาเหตุหลักที่โค้ดพังหนักขึ้นเรื่อยๆ

**English**
- If a fix causes a new error or makes things worse, roll back immediately. Do not patch on top of broken code.
  ```
  git checkout -- <file>       # revert a single file
  git reset --hard HEAD        # revert everything to last good state
  ```
- Allow at most 2 retry attempts on the same issue. If still unsolved, stop and explain what's blocking it — don't keep guessing.
- Never chase "fix the error caused by the previous fix" in an endless loop — this is the #1 cause of cascading breakage.

---

## 6. Merge กลับ / Merging Back

**ไทย**
- Merge กลับ `main` ได้เฉพาะเมื่อแก้เสร็จ ทดสอบผ่าน และ diff ถูกตรวจสอบแล้วเท่านั้น
- ถ้าไม่มั่นใจว่าการแก้จะกระทบส่วนอื่นหรือไม่ ให้ระบุความเสี่ยงนั้นไว้ตรงๆ ก่อน merge

**English**
- Only merge back to `main` after the fix is verified, tested, and the diff has been reviewed.
- If unsure whether a change affects other parts of the system, state that risk explicitly before merging.