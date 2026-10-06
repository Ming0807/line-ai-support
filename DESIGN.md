---
name: YRU Helpdesk Dashboard
description: Warm Thai support workspace with dark icon rail and coral overview
colors:
  ink: "#141622"
  muted: "#7e8299"
  paper: "#f4f3ef"
  surface: "#ffffff"
  line: "#e7e5df"
  primary: "#2563eb"
  primary-dark: "#1d4ed8"
  focus: "#ff4b72"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Leelawadee UI", sans-serif'
rounded:
  field: "0.5rem"
  panel: "1.75rem"
spacing:
  compact: "0.5rem"
  regular: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.field}"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
---

## Overview

7 ตุลาคม 2026 ผู้ใช้เลือกหน้าหลักและ sidebar จาก Gemini443c227 เป็น visual authority รอบต่อไป: dark icon rail, warm canvas, soft white cards และ coral hero. Tokensข้างบนอ่านจากCSSของcommitนั้น เป็นแนวทางที่อนุมัติด้านภาพ ไม่ใช่ผลยอมรับbehavior/contrastหรือclaimว่าmainbranchรวมUIแล้ว. [Review/page map](docs/reports/GEMINI_UI_UX_REVIEW_AND_PAGE_MAP.md) และ [round2 prompt](docs/agents/GEMINI_UI_UX_CONTINUATION_PROMPT.md) กำหนดงานที่ยังขาด

รักษาภาษาดีไซน์ที่ผู้ใช้ชอบและขยายไปหน้าอื่น. [Provider surface brief](docs/ui/PROVIDER_SURFACE_BRIEF.md) ยังเป็นfunctional/interactionreference แต่ข้อpaletteเก่าที่ขัดกับคำยืนยันล่าสุดถูกแทนด้วยแนวทางนี้. ไม่มีofficialbrandassetsหรือuniversityendorsementที่อนุมัติให้สร้างขึ้นเอง

## Colors

ใช้ neutralพื้นผิว/ข้อความ, darkrail, coral/pinkaccentบนOverviewและblueactionsตามtokensของ443c227. ไม่กลับไปใช้ธีมเขียวเดิม. สถานะsuccess/warning/errorใช้ข้อความหรือiconประกอบเสมอ แยกobservedhealthจากenabled/disabled และวัดcontrastจริงก่อนยอมรับ

สี status ของ layout ใหม่ยังต้องวัด contrast ตอน implementation ไม่คัดลอกสี screenshot ที่ยังไม่มี

## Typography

Baseline ใช้ font stack ที่รองรับภาษาไทยจาก frontmatter; heading, label และข้อมูลควรอยู่ในตระกูลเดียวกัน ตัดข้อความตาม layout โดย model ID ยาวยังอ่านเต็มได้ในรายละเอียด. ค่า HTTP, จำนวน quota และลำดับต้องอ่านเทียบกันง่าย

Provider implementation ใหม่ใช้ scale ในหน่วย rem ที่คงที่สำหรับหน้าทำงาน และตรวจภาษาไทยที่ zoom 200%. ไม่เพิ่ม display font หรือ external font dependency โดยไม่มีเหตุผล

## Layout

พื้นที่งานใช้ขอบหน้าและแถวข้อมูลสม่ำเสมอ. Desktop แสดง model rows แบบเปรียบเทียบได้; mobile เปลี่ยนลำดับข้อมูลและ actions โดยไม่บังคับเลื่อนทั้งหน้าในแนวนอน. Form เพิ่ม/แก้แสดงเมื่อเรียกใช้ แทนวาง form ยาวเต็มหน้าตลอดเวลา

Provider view ใหม่มี page title/action, free policy, tabs ตาม purpose, provider group และ model rows. รายละเอียด state/actions อยู่ใน surface brief ไม่สร้าง grid KPI ขนาดใหญ่ที่ไม่ช่วยจัดการ model

## Elevation & Depth

Visualauthority443c227ใช้white roundedcards/softshadowและcoralhero gradient. รักษาcompositionที่ผู้ใช้เลือก; หน้าตาราง/formใช้spacingที่กระชับและเส้นแบ่งชัด ลดcardซ้อนcard. Decorativeheroไม่ใช่analytics: กราฟ/percentที่อ่านเป็นข้อมูลต้องมีactualsource/ช่วงเวลา/นิยามตรงกัน

## Shapes

Baseline field และ panel ใช้มุมโค้งตาม frontmatter. รักษา vocabulary ของ button/input/status indicator ให้เหมือนกันใน tickets, providers และ knowledge. Focus outline ที่มีอยู่ใช้เส้นหนา (`3px`) พร้อม offset (`3px`)

## Components

- Buttons: primary หนึ่งงานหลักต่อบริเวณ; ขึ้น/ลงและทดสอบเป็น secondary actions ที่มีชื่ออ่านได้และ disabled/loading/error states
- Inputs: label อยู่กับ control, error ใกล้ field; secret field ไม่แสดง key เดิม. แสดง advanced fields เมื่อจำเป็น
- Status: แสดง HTTP พร้อมข้อความ เวลา และชนิดการตรวจ; UNKNOWN/PENDING ต้องมีรูปแบบของตนเอง
- Rows: identity → state → quota → actions; ไม่แยก HTTP เป็นหน้าที่ผู้ใช้ต้องไปค้นอีกที่
- Feedback: save/test สำเร็จหรือผิดพลาดอยู่ใกล้ action; conflict บอกให้โหลดข้อมูลล่าสุด ไม่ทำให้ผู้ใช้เข้าใจว่าบันทึกแล้ว

## Do's and Don'ts

- Do ใช้ภาษาไทยที่บอก action/result ตรง ๆ และคง provider/model IDs ที่เป็นชื่อจริง
- Do แสดง quota พร้อม scope/source และเวลาที่ตรวจ; ไม่ใช้สีอย่างเดียว
- Do ทำ keyboard focus, mobile touch และ reduced motion ก่อนรายงาน UI เสร็จ
- Don't ใช้ nested cards, decorative charts หรือ motion ที่ไม่อธิบาย state
- Don't แสดง HTTP 200 จาก metadata ว่า generation ผ่าน หรือ 429 ว่า daily quota หมดโดยไม่มีหลักฐาน
- Don't เปลี่ยน product truth, live statistics หรือ brand identity เพื่อให้ UI ดูเต็ม
