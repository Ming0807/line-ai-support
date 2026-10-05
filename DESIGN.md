---
name: YRU Helpdesk Dashboard
description: Restrained Thai product interface for university support operations
colors:
  ink: "#17272b"
  muted: "#52666b"
  paper: "#f4f7f5"
  surface: "#ffffff"
  line: "#d5e0dc"
  primary: "#155e4b"
  primary-dark: "#104b3c"
  focus: "#bf5b18"
typography:
  body:
    fontFamily: '"Leelawadee UI", "Th Sarabun New", Tahoma, sans-serif'
rounded:
  field: "0.5rem"
  panel: "0.8rem"
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

บันทึก baseline จาก `app/globals.css`, `app/providers.css` และ Dashboard code วันที่ 4 ตุลาคม 2026 ไม่ใช่รายงานว่าหน้า Provider ใหม่ render/QA แล้ว ผู้ใช้กำหนด product minimal: อ่านลำดับและสถานะได้เร็ว ทำ action ได้ตรง และใช้รูปแบบเดียวกันทั้งระบบ

คง vocabulary ของสีและ control ที่มีอยู่ก่อน ปรับ composition ของ Provider ตาม [surface brief](docs/ui/PROVIDER_SURFACE_BRIEF.md) ซึ่งแยกสิ่งที่วางแผนจาก incumbent UI. ไม่ถือว่าผู้ใช้เลือกธีมใหม่หรืออนุมัติ brand assets ที่ไม่มีอยู่

## Colors

สีเขียวหลักใช้กับ primary action/selection; neutral ใช้พื้นผิว ตัวอักษร เส้นแบ่ง และข้อความรอง ไม่ใช้ accent ตกแต่งทุก panel. สถานะ success/warning/error ใช้ข้อความหรือ icon ประกอบเสมอ และแยก status จาก enabled/disabled

สี status ของ layout ใหม่ยังต้องวัด contrast ตอน implementation ไม่คัดลอกสี screenshot ที่ยังไม่มี

## Typography

Baseline ใช้ font stack ที่รองรับภาษาไทยจาก frontmatter; heading, label และข้อมูลควรอยู่ในตระกูลเดียวกัน ตัดข้อความตาม layout โดย model ID ยาวยังอ่านเต็มได้ในรายละเอียด. ค่า HTTP, จำนวน quota และลำดับต้องอ่านเทียบกันง่าย

Provider implementation ใหม่ใช้ scale ในหน่วย rem ที่คงที่สำหรับหน้าทำงาน และตรวจภาษาไทยที่ zoom 200%. ไม่เพิ่ม display font หรือ external font dependency โดยไม่มีเหตุผล

## Layout

พื้นที่งานใช้ขอบหน้าและแถวข้อมูลสม่ำเสมอ. Desktop แสดง model rows แบบเปรียบเทียบได้; mobile เปลี่ยนลำดับข้อมูลและ actions โดยไม่บังคับเลื่อนทั้งหน้าในแนวนอน. Form เพิ่ม/แก้แสดงเมื่อเรียกใช้ แทนวาง form ยาวเต็มหน้าตลอดเวลา

Provider view ใหม่มี page title/action, free policy, tabs ตาม purpose, provider group และ model rows. รายละเอียด state/actions อยู่ใน surface brief ไม่สร้าง grid KPI ขนาดใหญ่ที่ไม่ช่วยจัดการ model

## Elevation & Depth

Incumbent ใช้ surface ขาวกับเส้นแบ่งและ shadow เบา; panel หลักมี shadow (`0 5px 16px #17382d0c`). หน้าทำงานใหม่ใช้เส้นแบ่งและ tonal surface เป็นหลัก ลดการซ้อน card ใน card ไม่เพิ่ม blur/glass/gradient เป็นวัสดุใหม่

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
