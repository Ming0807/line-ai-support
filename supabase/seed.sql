insert into public.departments(code,name_th,name_en) values
 ('IT','เทคโนโลยีสารสนเทศ','Information Technology'),
 ('REGISTRAR','งานทะเบียน','Registrar'),
 ('STUDENT_AFFAIRS','กิจการนักศึกษา','Student Affairs'),
 ('LIBRARY','ห้องสมุด','Library'),
 ('DORMITORY','หอพัก','Dormitory'),
 ('FINANCE','การเงิน','Finance'),
 ('ACADEMIC_AFFAIRS','วิชาการ','Academic Affairs'),
 ('FACILITY','อาคารและสถานที่','Facility'),
 ('ADMIN','ผู้ดูแลระบบ','Administration')
on conflict(code) do update set name_th=excluded.name_th,name_en=excluded.name_en;
