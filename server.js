const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const PDFDocument = require('pdfkit');

const app = express();
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
if (production && (!sessionSecret || sessionSecret.length < 32)) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters.');
}
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'clinical.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
const sessionKey = sessionSecret || crypto.randomBytes(48).toString('hex');
db.exec(`
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, dob TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT NOT NULL, license TEXT NOT NULL UNIQUE, specialization TEXT NOT NULL, additional_specializations TEXT NOT NULL DEFAULT '[]',
  experience INTEGER NOT NULL CHECK(experience BETWEEN 0 AND 80), clinic TEXT NOT NULL, clinic_address TEXT NOT NULL,
  timings TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', password_hash TEXT NOT NULL, verification TEXT NOT NULL DEFAULT 'pending'
    CHECK(verification IN ('pending','verified','rejected')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), name TEXT NOT NULL, dob TEXT NOT NULL,
  phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', emergency_name TEXT NOT NULL, emergency_relationship TEXT NOT NULL,
  emergency_phone TEXT NOT NULL, house TEXT NOT NULL, street TEXT NOT NULL, locality TEXT NOT NULL,
  city TEXT NOT NULL, district TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, pin TEXT NOT NULL, country TEXT NOT NULL,
  history TEXT NOT NULL, conditions TEXT NOT NULL, allergies TEXT NOT NULL, medications TEXT NOT NULL,
  surgeries TEXT NOT NULL, family_history TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), patient_id TEXT NOT NULL REFERENCES patients(id),
  starts_at TEXT NOT NULL, duration INTEGER NOT NULL CHECK(duration BETWEEN 10 AND 240), mode TEXT NOT NULL CHECK(mode IN ('In-Person','Online')),
  reason TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Scheduled'
    CHECK(status IN ('Scheduled','Confirmed','In Progress','Completed','Cancelled','No-Show')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), patient_id TEXT NOT NULL REFERENCES patients(id),
  appointment_id TEXT REFERENCES appointments(id), complaint TEXT NOT NULL DEFAULT '', symptoms TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '', findings TEXT NOT NULL DEFAULT '', diagnosis TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', follow_up TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consultation_amendments (
  id TEXT PRIMARY KEY, consultation_id TEXT NOT NULL REFERENCES consultations(id), doctor_id TEXT NOT NULL REFERENCES doctors(id),
  reason TEXT NOT NULL, changes TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), patient_id TEXT NOT NULL REFERENCES patients(id),
  consultation_id TEXT REFERENCES consultations(id), diagnosis TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '', medications TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','finalized')), version INTEGER NOT NULL DEFAULT 1, supersedes_id TEXT REFERENCES prescriptions(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mental_records (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), patient_id TEXT NOT NULL REFERENCES patients(id),
  appointment_id TEXT REFERENCES appointments(id), presenting TEXT NOT NULL DEFAULT '', symptoms TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '', treatments TEXT NOT NULL DEFAULT '', family_history TEXT NOT NULL DEFAULT '',
  observations TEXT NOT NULL DEFAULT '', assessment TEXT NOT NULL DEFAULT '', goals TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '', follow_up TEXT NOT NULL DEFAULT '', progress TEXT NOT NULL DEFAULT '',
  referrals TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 16 CHECK(capacity BETWEEN 1 AND 30),
  UNIQUE(doctor_id,weekday,start_time,end_time)
);
CREATE TABLE IF NOT EXISTS blocked_dates (
  doctor_id TEXT NOT NULL REFERENCES doctors(id), date TEXT NOT NULL, PRIMARY KEY(doctor_id,date)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS doctor_settings (
  doctor_id TEXT PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
  in_app_notifications INTEGER NOT NULL DEFAULT 1 CHECK(in_app_notifications IN (0,1))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES doctors(id), action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_doctor_idx ON patients(doctor_id);
CREATE UNIQUE INDEX IF NOT EXISTS patients_doctor_identity_idx ON patients(doctor_id,lower(name),dob,phone);
CREATE INDEX IF NOT EXISTS appointments_doctor_time_idx ON appointments(doctor_id,starts_at);
CREATE INDEX IF NOT EXISTS consultations_patient_idx ON consultations(patient_id,created_at);
CREATE INDEX IF NOT EXISTS prescriptions_patient_idx ON prescriptions(patient_id,created_at);
`);

app.disable('x-powered-by');
app.use(express.json({ limit: '48kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: production ? '1h' : 0 }));

const allowedSpecializations = ['General Physician','Cardiologist','Dermatologist','Neurologist','Psychiatrist','Clinical Psychologist','Pediatrician','Orthopedic Specialist','Gynecologist','Ophthalmologist','ENT Specialist','Pulmonologist','Gastroenterologist','Endocrinologist','Nephrologist','Oncologist','Dentist','Urologist','Other'];
const authAttempts = new Map();
const hash = value => crypto.createHmac('sha256',sessionKey).update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const id = prefix => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const text = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validPhone = value => /^\+?[0-9 ()-]{8,18}$/.test(String(value || '').trim()) && String(value).replace(/\D/g, '').length >= 8;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
const validTimezone = value => {
  try { new Intl.DateTimeFormat('en-US',{timeZone:value}); return true; } catch { return false; }
};
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const secureEqual = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const fail = (res, status, message) => res.status(status).json({ error: message });
function audit(doctorId, action, entity, entityId) {
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), doctorId, action, entity, entityId, timestamp());
}
function notify(doctorId,title,body) {
  const settings=db.prepare('SELECT in_app_notifications FROM doctor_settings WHERE doctor_id=?').get(doctorId);
  if(settings?.in_app_notifications===0)return;
  db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),doctorId,title,body,0,timestamp());
}
function sessionToken(req) {
  const match = /(?:^|;\s*)doctor_session=([^;]+)/.exec(req.headers.cookie || '');
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}
function doctorAuth(req, res, next) {
  const token = sessionToken(req);
  if (!token) return fail(res, 401, 'Please sign in.');
  const session = db.prepare(`SELECT s.token_hash,s.doctor_id AS id,s.csrf,s.expires_at,d.name,d.email,d.specialization,d.additional_specializations,
    d.license,d.clinic,d.clinic_address,d.verification,d.timings,d.timezone,d.experience FROM sessions s JOIN doctors d ON d.id=s.doctor_id
    WHERE s.token_hash=?`).get(hash(token));
  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
    res.clearCookie('doctor_session', { httpOnly: true, sameSite: 'strict', secure: production, path: '/' });
    return fail(res, 401, 'Your session expired. Please sign in again.');
  }
  req.doctor = session;
  next();
}
function csrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  if (!secureEqual(req.headers['x-csrf-token'], req.doctor.csrf)) return fail(res, 403, 'Security token expired. Refresh and try again.');
  next();
}
const verified = (req, res, next) => req.doctor.verification === 'verified'
  ? next() : fail(res, 403, 'Your credentials are pending verification. Clinical workspace access is unavailable until verification is complete.');
const canPrescribe = (req, res, next) => req.doctor.specialization !== 'Clinical Psychologist'
  ? next() : fail(res, 403, 'Prescription access is not enabled for the verified professional role on this account.');
const psychiatrist = (req, res, next) => req.doctor.specialization === 'Psychiatrist' && req.doctor.verification === 'verified'
  ? next() : fail(res, 403, 'This confidential workspace is restricted to verified psychiatrists.');
function patientValidation(b) {
  const required = ['name','phone','emergency_name','emergency_relationship','emergency_phone','house','street','locality','city','state','pin','country'];
  const missing = required.find(key => !text(b[key], 250));
  if (missing) return `${missing.replaceAll('_',' ')} is required.`;
  if (!text(b.dob,30) && (!/^\d{1,3}$/.test(text(b.age,3)) || Number(b.age) > 130)) return 'Enter a valid date of birth or age.';
  if (text(b.dob,30) && (!validDate(b.dob) || new Date(`${b.dob}T00:00:00Z`) > new Date())) return 'Enter a valid date of birth.';
  if (!validPhone(b.phone) || !validPhone(b.emergency_phone)) return 'Enter valid patient and emergency-contact phone numbers.';
  const postalCode=text(b.pin,12);
  if (text(b.country,100).toLowerCase()==='india'?!/^[1-9]\d{5}$/.test(postalCode):!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(postalCode)) return 'Enter a valid PIN/postal code for the selected country.';
  return null;
}
function ownPatient(req, res, next) {
  req.patient = db.prepare('SELECT * FROM patients WHERE id=? AND doctor_id=?').get(req.params.id, req.doctor.id);
  if (!req.patient) return fail(res, 404, 'Patient not found.');
  next();
}
function publicPatient(patient) {
  if (!patient) return patient;
  const { doctor_id, ...record } = patient;
  return record;
}
function localTimeParts(value, timezone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
    timeZone:timezone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(value).map(part=>[part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,
    weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)};
}
function appointmentConflict(doctorId, timezone, startsAt, duration, excludeId = '') {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return 'Enter a valid appointment date and time.';
  if (start < Date.now() - 60000) return 'Appointment must be in the future.';
  if (!Number.isInteger(duration) || duration < 10 || duration > 240) return 'Duration must be between 10 and 240 minutes.';
  const end = start + duration * 60000;
  const appointments = db.prepare(`SELECT id,starts_at,duration FROM appointments WHERE doctor_id=? AND status NOT IN ('Cancelled','No-Show') AND id<>?`)
    .all(doctorId, excludeId);
  if (appointments.some(a => start < Date.parse(a.starts_at) + a.duration * 60000 && end > Date.parse(a.starts_at))) return 'This time overlaps another appointment.';
  const date = new Date(start);
  const localStart=localTimeParts(date,timezone);
  const localEnd=localTimeParts(new Date(end),timezone);
  const dateString = localStart.date;
  if (db.prepare('SELECT 1 FROM blocked_dates WHERE doctor_id=? AND date=?').get(doctorId,dateString)) return 'This date is unavailable.';
  const allSlots=db.prepare('SELECT weekday,start_time,end_time,capacity FROM availability WHERE doctor_id=?').all(doctorId);
  const slots=allSlots.filter(slot=>slot.weekday===localStart.weekday);
  const slot=slots.find(item=>localStart.time>=item.start_time&&localEnd.time<=item.end_time);
  if (allSlots.length && (localStart.date!==localEnd.date || !slot)) return 'Appointment is outside your available consultation hours.';
  if(slot){
    const booked=db.prepare(`SELECT starts_at FROM appointments WHERE doctor_id=? AND starts_at BETWEEN ? AND ?
      AND status NOT IN ('Cancelled','No-Show') AND id<>?`).all(doctorId,new Date(start-36*3600000).toISOString(),new Date(start+36*3600000).toISOString(),excludeId);
    const count=booked.filter(item=>{
      const local=localTimeParts(new Date(item.starts_at),timezone);
      return local.date===localStart.date&&local.time>=slot.start_time&&local.time<slot.end_time;
    }).length;
    if(count>=slot.capacity)return 'Appointment capacity for this consultation window has been reached.';
  }
  return null;
}
const api = express.Router();
api.get('/health',(_req,res)=>res.json({status:'ok'}));

api.post('/register', async (req,res) => {
  const b=req.body||{};
  const required=['name','dob','email','phone','license','specialization','clinic','clinic_address','timings','password','confirm_password'];
  if(required.some(k=>!text(b[k],k.includes('password')?200:500)))return fail(res,400,'Complete all required registration fields.');
  if(!validEmail(b.email)||!validPhone(b.phone)||!validDate(b.dob)||new Date(`${b.dob}T00:00:00Z`)>new Date())return fail(res,400,'Enter valid email, phone, and date of birth.');
  if(typeof b.password!=='string'||typeof b.confirm_password!=='string'||b.password.length<12||b.password.length>200)return fail(res,400,'Password must contain at least 12 characters.');
  if(b.password!==b.confirm_password)return fail(res,400,'Passwords do not match.');
  if(!Number.isInteger(Number(b.experience))||Number(b.experience)<0||Number(b.experience)>80)return fail(res,400,'Enter valid years of experience.');
  if(!allowedSpecializations.includes(b.specialization))return fail(res,400,'Select a valid specialization.');
  if(db.prepare('SELECT 1 FROM doctors WHERE email=? COLLATE NOCASE OR license=?').get(text(b.email,254),text(b.license,100)))return fail(res,409,'Email or medical registration number is already registered.');
  const salt=crypto.randomBytes(16);
  const passwordHash=await new Promise((resolve,reject)=>crypto.scrypt(b.password,salt,64,(err,key)=>err?reject(err):resolve(`${salt.toString('hex')}:${key.toString('hex')}`)));
  const doctorId=crypto.randomUUID();
  try {
    const timezone=text(b.timezone,100)||'Asia/Kolkata';
    if(!validTimezone(timezone))return fail(res,400,'Enter a valid time-zone identifier.');
    db.prepare(`INSERT INTO doctors(id,name,dob,email,phone,license,specialization,additional_specializations,experience,clinic,clinic_address,timings,timezone,password_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(doctorId,text(b.name,150),b.dob,text(b.email,254).toLowerCase(),text(b.phone,25),text(b.license,100),b.specialization,
      JSON.stringify(Array.isArray(b.additional_specializations)?b.additional_specializations.filter(x=>allowedSpecializations.includes(x)&&x!==b.specialization).slice(0,8):[]),
      Number(b.experience),text(b.clinic,180),text(b.clinic_address,500),text(b.timings,500),timezone,passwordHash,timestamp());
  } catch(error) {
    if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return fail(res,409,'Email or medical registration number is already registered.');
    throw error;
  }
  res.status(201).json({message:'Registration received. Your credentials are pending verification. Clinical access remains locked until verification is complete.'});
});
api.post('/login',async(req,res)=>{
  const email=text(req.body?.email,254).toLowerCase(),key=`${req.ip}:${email}`;
  const attempt=authAttempts.get(key)||{count:0,until:0};
  if(attempt.until>Date.now())return fail(res,429,'Too many sign-in attempts. Try again later.');
  const doctor=db.prepare('SELECT id,password_hash FROM doctors WHERE email=? COLLATE NOCASE').get(email);
  const [saltHex,expectedHex]=(doctor?.password_hash||`${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual=await new Promise((resolve,reject)=>crypto.scrypt(String(req.body?.password||'').slice(0,200),Buffer.from(saltHex,'hex'),64,(err,keyBytes)=>err?reject(err):resolve(keyBytes)));
  if(!doctor||!crypto.timingSafeEqual(actual,Buffer.from(expectedHex,'hex'))){
    attempt.count++;if(attempt.count>=8){attempt.until=Date.now()+15*60*1000;attempt.count=0;}authAttempts.set(key,attempt);
    return fail(res,401,'Email or password is incorrect.');
  }
  authAttempts.delete(key);
  const token=crypto.randomBytes(32).toString('base64url'),csrfToken=crypto.randomBytes(24).toString('base64url');
  const expiry=Date.now()+(req.body?.remember===true?30:1)*24*60*60*1000;
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),doctor.id,csrfToken,expiry);
  res.cookie('doctor_session',token,{httpOnly:true,sameSite:'strict',secure:production,path:'/',maxAge:expiry-Date.now()});
  res.json({csrf:csrfToken});
});
api.post('/forgot-password',(_req,res)=>res.json({message:'Self-service recovery is not configured. Contact the clinic administrator through its verified identity process.'}));
api.post('/admin/doctors/:id/verify',(req,res)=>{
  const configured=process.env.VERIFICATION_ADMIN_TOKEN;
  if(!configured||!secureEqual(req.headers['x-verification-token'],configured))return fail(res,403,'Credential verifier authorization required.');
  if(!['verified','rejected'].includes(req.body?.status))return fail(res,400,'Status must be verified or rejected.');
  const result=db.prepare('UPDATE doctors SET verification=? WHERE id=?').run(req.body.status,req.params.id);
  if(!result.changes)return fail(res,404,'Doctor not found.');
  audit(req.params.id,`credential.${req.body.status}`,'doctor',req.params.id);
  notify(req.params.id,'Credential status updated','Your credential verification status changed.');
  res.json({message:'Verification status updated.'});
});
api.use(doctorAuth,csrf);
api.get('/me',(req,res)=>{
  const d=req.doctor;
  res.json({csrf:d.csrf,doctor:{id:d.id,name:d.name,email:d.email,specialization:d.specialization,
    additional_specializations:JSON.parse(d.additional_specializations),license:d.license,clinic:d.clinic,
    clinic_address:d.clinic_address,verification:d.verification,timings:d.timings,timezone:d.timezone,experience:d.experience}});
});
api.post('/logout',(req,res)=>{
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.doctor.token_hash);
  res.clearCookie('doctor_session',{httpOnly:true,sameSite:'strict',secure:production,path:'/'});
  res.json({message:'Signed out.'});
});
api.put('/password',async(req,res)=>{
  const b=req.body||{};
  const doctor=db.prepare('SELECT password_hash FROM doctors WHERE id=?').get(req.doctor.id);
  const [saltHex,expectedHex]=doctor.password_hash.split(':');
  const actual=await new Promise((resolve,reject)=>crypto.scrypt(String(b.current_password||'').slice(0,200),Buffer.from(saltHex,'hex'),64,(err,keyBytes)=>err?reject(err):resolve(keyBytes)));
  if(!crypto.timingSafeEqual(actual,Buffer.from(expectedHex,'hex')))return fail(res,400,'Current password is incorrect.');
  if(typeof b.new_password!=='string'||b.new_password.length<12||b.new_password.length>200)return fail(res,400,'New password must contain at least 12 characters.');
  const salt=crypto.randomBytes(16);
  const nextHash=await new Promise((resolve,reject)=>crypto.scrypt(b.new_password,salt,64,(err,keyBytes)=>err?reject(err):resolve(`${salt.toString('hex')}:${keyBytes.toString('hex')}`)));
  db.prepare('UPDATE doctors SET password_hash=? WHERE id=?').run(nextHash,req.doctor.id);
  db.prepare('DELETE FROM sessions WHERE doctor_id=?').run(req.doctor.id);
  audit(req.doctor.id,'password.changed','doctor',req.doctor.id);
  res.clearCookie('doctor_session',{httpOnly:true,sameSite:'strict',secure:production,path:'/'});
  res.json({message:'Password updated. Please sign in again.'});
});

api.get('/dashboard',verified,(req,res)=>{
  const doctorId=req.doctor.id,today=localTimeParts(new Date(),req.doctor.timezone).date;
  const patientCount=db.prepare('SELECT COUNT(*) count FROM patients WHERE doctor_id=?').get(doctorId).count;
  const nearby=db.prepare(`SELECT a.id,a.patient_id,p.name patient_name,a.starts_at,a.duration,a.mode,a.status,a.reason
    FROM appointments a JOIN patients p ON p.id=a.patient_id WHERE a.doctor_id=? AND a.starts_at BETWEEN ? AND ? ORDER BY a.starts_at`)
    .all(doctorId,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+172800000).toISOString());
  const todayAppointments=nearby.filter(appointment=>localTimeParts(new Date(appointment.starts_at),req.doctor.timezone).date===today);
  const statusRows=db.prepare('SELECT status,COUNT(*) count FROM appointments WHERE doctor_id=? GROUP BY status').all(doctorId);
  const counts=Object.fromEntries(statusRows.map(row=>[row.status,row.count]));
  const upcomingCount=db.prepare(`SELECT COUNT(*) count FROM appointments WHERE doctor_id=? AND starts_at>=? AND status NOT IN ('Cancelled','Completed','No-Show')`)
    .get(doctorId,timestamp()).count;
  const completedConsultations=db.prepare("SELECT COUNT(*) count FROM consultations WHERE doctor_id=? AND status='finalized'").get(doctorId).count;
  res.json({patient_count:patientCount,today_appointments:todayAppointments,upcoming_count:upcomingCount,
    upcoming:db.prepare(`SELECT a.id,p.name patient_name,a.starts_at,a.status,a.reason FROM appointments a JOIN patients p ON p.id=a.patient_id
      WHERE a.doctor_id=? AND a.starts_at>=? AND a.status NOT IN ('Cancelled','Completed','No-Show') ORDER BY a.starts_at LIMIT 8`).all(doctorId,timestamp()),
    totals:{completed:completedConsultations,pending:(counts.Scheduled||0)+(counts.Confirmed||0),cancelled:counts.Cancelled||0},
    recent_activity:db.prepare('SELECT action,entity,created_at FROM audit_logs WHERE doctor_id=? ORDER BY created_at DESC LIMIT 5').all(doctorId)});
});
api.get('/patients',verified,(req,res)=>{
  const q=`%${text(req.query.q,100).replace(/[%_]/g,'')}%`;
  res.json(db.prepare(`SELECT id,name,dob,phone,created_at,updated_at FROM patients WHERE doctor_id=? AND
    (name LIKE ? OR phone LIKE ? OR id LIKE ?) ORDER BY name LIMIT 250`).all(req.doctor.id,q,q,q));
});
api.post('/patients',verified,(req,res)=>{
  const b=req.body||{},error=patientValidation(b);if(error)return fail(res,400,error);
  const birthInfo=text(b.dob,30)||`Age: ${Number(b.age)}`;
  if(db.prepare('SELECT 1 FROM patients WHERE doctor_id=? AND lower(name)=lower(?) AND dob=? AND phone=?')
    .get(req.doctor.id,text(b.name,150),birthInfo,text(b.phone,25)))return fail(res,409,'A patient with the same name, date of birth or age, and phone number is already in your records.');
  const time=timestamp(),patientId=id('PT');
  const columns=['name','dob','phone','email','emergency_name','emergency_relationship','emergency_phone','house','street','locality','city','district','state','pin','country','history','conditions','allergies','medications','surgeries','family_history','notes'];
  const values=[patientId,req.doctor.id,text(b.name,150),birthInfo,text(b.phone,25),text(b.email,254),text(b.emergency_name,150),text(b.emergency_relationship,100),text(b.emergency_phone,25),
    text(b.house,150),text(b.street,200),text(b.locality,200),text(b.city,120),text(b.district,120),text(b.state,120),text(b.pin,12),text(b.country,100),
    ...['history','conditions','allergies','medications','surgeries','family_history','notes'].map(k=>text(b[k],3000)),time,time];
  db.prepare(`INSERT INTO patients(id,doctor_id,${columns.join(',')},created_at,updated_at) VALUES(?,?${',?'.repeat(columns.length+2)})`).run(...values);
  audit(req.doctor.id,'patient.created','patient',patientId);
  res.status(201).json(publicPatient(db.prepare('SELECT * FROM patients WHERE id=?').get(patientId)));
});
api.get('/patients/:id',verified,ownPatient,(req,res)=>{
  audit(req.doctor.id,'patient.viewed','patient',req.patient.id);
  res.json({patient:publicPatient(req.patient),
    appointments:db.prepare('SELECT id,starts_at,duration,mode,reason,status FROM appointments WHERE doctor_id=? AND patient_id=? ORDER BY starts_at DESC LIMIT 100').all(req.doctor.id,req.patient.id),
    consultations:db.prepare('SELECT * FROM consultations WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC').all(req.doctor.id,req.patient.id),
    prescriptions:db.prepare('SELECT * FROM prescriptions WHERE doctor_id=? AND patient_id=? ORDER BY created_at DESC').all(req.doctor.id,req.patient.id)});
});
api.put('/patients/:id',verified,ownPatient,(req,res)=>{
  const b=req.body||{},error=patientValidation(b);if(error)return fail(res,400,error);
  const birthInfo=text(b.dob,30)||`Age: ${Number(b.age)}`;
  if(db.prepare('SELECT 1 FROM patients WHERE doctor_id=? AND lower(name)=lower(?) AND dob=? AND phone=? AND id<>?')
    .get(req.doctor.id,text(b.name,150),birthInfo,text(b.phone,25),req.patient.id))return fail(res,409,'Another patient record already has the same name, date of birth or age, and phone number.');
  const columns=['name','dob','phone','email','emergency_name','emergency_relationship','emergency_phone','house','street','locality','city','district','state','pin','country','history','conditions','allergies','medications','surgeries','family_history','notes'];
  const values=[text(b.name,150),birthInfo,text(b.phone,25),text(b.email,254),text(b.emergency_name,150),text(b.emergency_relationship,100),text(b.emergency_phone,25),
    text(b.house,150),text(b.street,200),text(b.locality,200),text(b.city,120),text(b.district,120),text(b.state,120),text(b.pin,12),text(b.country,100),
    ...['history','conditions','allergies','medications','surgeries','family_history','notes'].map(k=>text(b[k],3000)),timestamp(),req.patient.id,req.doctor.id];
  db.prepare(`UPDATE patients SET ${columns.map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=? AND doctor_id=?`).run(...values);
  audit(req.doctor.id,'patient.updated','patient',req.patient.id);
  res.json(publicPatient(db.prepare('SELECT * FROM patients WHERE id=?').get(req.patient.id)));
});

api.get('/appointments',verified,(req,res)=>{
  const status=text(req.query.status,30);
  res.json(db.prepare(`SELECT a.*,p.name patient_name FROM appointments a JOIN patients p ON p.id=a.patient_id
    WHERE a.doctor_id=? AND (?='' OR a.status=?) ORDER BY a.starts_at DESC LIMIT 500`).all(req.doctor.id,status,status));
});
api.post('/appointments',verified,(req,res)=>{
  const b=req.body||{},duration=Number(b.duration);
  if(typeof b.patient_id!=='string'||!b.patient_id)return fail(res,400,'Select a patient.');
  if(!db.prepare('SELECT 1 FROM patients WHERE id=? AND doctor_id=?').get(b.patient_id,req.doctor.id))return fail(res,404,'Patient not found.');
  if(!['In-Person','Online'].includes(b.mode))return fail(res,400,'Choose an appointment type.');
  const error=appointmentConflict(req.doctor.id,req.doctor.timezone,b.starts_at,duration);if(error)return fail(res,409,error);
  const appointmentId=id('AP'),time=timestamp();
  db.prepare('INSERT INTO appointments(id,doctor_id,patient_id,starts_at,duration,mode,reason,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(appointmentId,req.doctor.id,b.patient_id,b.starts_at,duration,b.mode,text(b.reason,300),text(b.notes,1000),time,time);
  notify(req.doctor.id,'Appointment scheduled','An appointment has been scheduled.');
  audit(req.doctor.id,'appointment.created','appointment',appointmentId);
  res.status(201).json({id:appointmentId});
});
api.patch('/appointments/:id',verified,(req,res)=>{
  const appointment=db.prepare('SELECT * FROM appointments WHERE id=? AND doctor_id=?').get(req.params.id,req.doctor.id);
  if(!appointment)return fail(res,404,'Appointment not found.');
  const {status,starts_at}=req.body||{};
  if(status&&!['Scheduled','Confirmed','In Progress','Completed','Cancelled','No-Show'].includes(status))return fail(res,400,'Invalid appointment status.');
  const duration=req.body?.duration===undefined?appointment.duration:Number(req.body.duration);
  const nextStart=starts_at||appointment.starts_at;
  if(starts_at||req.body?.duration!==undefined){
    const error=appointmentConflict(req.doctor.id,req.doctor.timezone,nextStart,duration,appointment.id);if(error)return fail(res,409,error);
  }
  const mode=req.body?.mode||appointment.mode;
  if(!['In-Person','Online'].includes(mode))return fail(res,400,'Choose an appointment type.');
  db.prepare(`UPDATE appointments SET status=?,starts_at=?,duration=?,mode=?,reason=?,notes=?,updated_at=? WHERE id=? AND doctor_id=?`)
    .run(status||appointment.status,nextStart,duration,mode,text(req.body?.reason??appointment.reason,300),text(req.body?.notes??appointment.notes,1000),
      timestamp(),appointment.id,req.doctor.id);
  audit(req.doctor.id,`appointment.${status?.toLowerCase()||'rescheduled'}`,'appointment',appointment.id);
  if(status==='Cancelled'||starts_at)notify(req.doctor.id,status==='Cancelled'?'Appointment cancelled':'Appointment rescheduled','An appointment has been updated.');
  res.json({message:'Appointment updated.'});
});

api.get('/consultations',verified,(req,res)=>res.json(db.prepare(`SELECT c.*,p.name patient_name FROM consultations c JOIN patients p ON p.id=c.patient_id
  WHERE c.doctor_id=? ORDER BY c.created_at DESC LIMIT 300`).all(req.doctor.id)));
api.get('/consultations/:id',verified,(req,res)=>{
  const consultation=db.prepare('SELECT * FROM consultations WHERE id=? AND doctor_id=?').get(req.params.id,req.doctor.id);
  if(!consultation)return fail(res,404,'Consultation not found.');
  audit(req.doctor.id,'consultation.viewed','consultation',consultation.id);
  res.json({consultation,amendments:db.prepare('SELECT reason,changes,created_at FROM consultation_amendments WHERE consultation_id=? AND doctor_id=? ORDER BY created_at').all(consultation.id,req.doctor.id)});
});
api.post('/consultations',verified,(req,res)=>{
  const b=req.body||{};
  if(typeof b.patient_id!=='string'||!b.patient_id)return fail(res,400,'Select a patient.');
  if(!db.prepare('SELECT 1 FROM patients WHERE id=? AND doctor_id=?').get(b.patient_id,req.doctor.id))return fail(res,404,'Patient not found.');
  if(b.appointment_id&&(typeof b.appointment_id!=='string'||!db.prepare("SELECT 1 FROM appointments WHERE id=? AND doctor_id=? AND patient_id=? AND status<>'Cancelled'").get(b.appointment_id,req.doctor.id,b.patient_id)))return fail(res,400,'Appointment does not match this patient.');
  const consultationId=crypto.randomUUID(),time=timestamp(),columns=['complaint','symptoms','history','findings','diagnosis','plan','notes','follow_up'];
  db.prepare(`INSERT INTO consultations(id,doctor_id,patient_id,appointment_id,${columns.join(',')},created_at,updated_at)
    VALUES(?,?,?,?${',?'.repeat(columns.length+2)})`).run(consultationId,req.doctor.id,b.patient_id,b.appointment_id||null,...columns.map(k=>text(b[k],3000)),time,time);
  audit(req.doctor.id,'consultation.draft_created','consultation',consultationId);
  res.status(201).json({id:consultationId});
});
api.patch('/consultations/:id',verified,(req,res)=>{
  const c=db.prepare('SELECT * FROM consultations WHERE id=? AND doctor_id=?').get(req.params.id,req.doctor.id);
  if(!c)return fail(res,404,'Consultation not found.');
  const columns=['complaint','symptoms','history','findings','diagnosis','plan','notes','follow_up'],b=req.body||{};
  if(c.status==='finalized'){
    const reason=text(b.amendment_reason,500);
    if(!reason)return fail(res,409,'Finalized records are read-only. Add an amendment reason to append a correction.');
    const changes={};
    for(const key of columns)if(typeof b[key]==='string'&&b[key]!==c[key])changes[key]={from:c[key],to:text(b[key],3000)};
    if(!Object.keys(changes).length)return fail(res,400,'No changes to record.');
    db.prepare('INSERT INTO consultation_amendments VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),c.id,req.doctor.id,reason,JSON.stringify(changes),timestamp());
    audit(req.doctor.id,'consultation.amended','consultation',c.id);
    return res.json({message:'Amendment appended to the finalized consultation.'});
  }
  const status=b.finalize===true?'finalized':'draft';
  if(status==='finalized'&&!text(b.complaint??c.complaint,3000))return fail(res,400,'A chief complaint is required before finalization.');
  db.prepare(`UPDATE consultations SET ${columns.map(k=>`${k}=?`).join(',')},status=?,updated_at=? WHERE id=? AND doctor_id=?`)
    .run(...columns.map(k=>text(b[k]??c[k],3000)),status,timestamp(),c.id,req.doctor.id);
  if(status==='finalized'&&c.appointment_id)db.prepare("UPDATE appointments SET status='Completed',updated_at=? WHERE id=? AND doctor_id=? AND status NOT IN ('Cancelled','No-Show')")
    .run(timestamp(),c.appointment_id,req.doctor.id);
  audit(req.doctor.id,`consultation.${status}`,'consultation',c.id);
  res.json({message:`Consultation ${status}.`});
});

api.get('/prescriptions',verified,canPrescribe,(req,res)=>res.json(db.prepare(`SELECT r.*,p.name patient_name FROM prescriptions r JOIN patients p ON p.id=r.patient_id
  WHERE r.doctor_id=? ORDER BY r.created_at DESC LIMIT 300`).all(req.doctor.id)));
function normalizeMedications(medications) {
  if(!Array.isArray(medications)||medications.length>30)return null;
  if(medications.some(m=>!m||typeof m!=='object'||Array.isArray(m)))return null;
  const result=medications.map(m=>({name:text(m.name,150),strength:text(m.strength,100),dosage:text(m.dosage,120),route:text(m.route,80),
    frequency:text(m.frequency,120),duration:text(m.duration,100),quantity:text(m.quantity,80),instructions:text(m.instructions,500),precautions:text(m.precautions,500)}));
  return result;
}
function medicationFinalizationError(medications) {
  const required=['name','strength','dosage','route','frequency','duration','quantity'];
  if(!medications.length||medications.some(m=>required.some(key=>!m[key]||!m.instructions||!m.precautions)))return 'Complete all medication fields before finalizing.';
  return null;
}
api.post('/prescriptions',verified,canPrescribe,(req,res)=>{
  const b=req.body||{};
  if(typeof b.patient_id!=='string'||!b.patient_id)return fail(res,400,'Select a patient.');
  if(!db.prepare('SELECT 1 FROM patients WHERE id=? AND doctor_id=?').get(b.patient_id,req.doctor.id))return fail(res,404,'Patient not found.');
  if(b.consultation_id&&(typeof b.consultation_id!=='string'||!db.prepare('SELECT 1 FROM consultations WHERE id=? AND doctor_id=? AND patient_id=?').get(b.consultation_id,req.doctor.id,b.patient_id)))return fail(res,400,'Consultation does not match this patient.');
  const medications=normalizeMedications(b.medications);if(!medications)return fail(res,400,'Add one or more medications with a medicine name.');
  const prescriptionId=crypto.randomUUID(),time=timestamp();
  db.prepare('INSERT INTO prescriptions(id,doctor_id,patient_id,consultation_id,diagnosis,instructions,follow_up,medications,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(prescriptionId,req.doctor.id,b.patient_id,b.consultation_id||null,text(b.diagnosis,1000),text(b.instructions,2000),text(b.follow_up,30),JSON.stringify(medications),time,time);
  audit(req.doctor.id,'prescription.draft_created','prescription',prescriptionId);
  res.status(201).json({id:prescriptionId});
});
api.patch('/prescriptions/:id',verified,canPrescribe,(req,res)=>{
  const p=db.prepare('SELECT * FROM prescriptions WHERE id=? AND doctor_id=?').get(req.params.id,req.doctor.id);
  if(!p)return fail(res,404,'Prescription not found.');
  if(p.status==='finalized')return fail(res,409,'Finalized prescriptions are read-only. Create a new prescription version instead.');
  const b=req.body||{},medications=normalizeMedications(b.medications);
  if(!medications)return fail(res,400,'Add one or more medications with a medicine name.');
  const status=b.finalize===true?'finalized':'draft';
  if(status==='finalized'){const error=medicationFinalizationError(medications);if(error)return fail(res,400,error);}
  db.prepare('UPDATE prescriptions SET diagnosis=?,instructions=?,follow_up=?,medications=?,status=?,updated_at=? WHERE id=? AND doctor_id=?')
    .run(text(b.diagnosis,1000),text(b.instructions,2000),text(b.follow_up,30),JSON.stringify(medications),status,timestamp(),p.id,req.doctor.id);
  audit(req.doctor.id,`prescription.${status}`,'prescription',p.id);
  res.json({message:`Prescription ${status}.`});
});
api.post('/prescriptions/:id/version',verified,canPrescribe,(req,res)=>{
  const old=db.prepare("SELECT * FROM prescriptions WHERE id=? AND doctor_id=? AND status='finalized'").get(req.params.id,req.doctor.id);
  if(!old)return fail(res,404,'Finalized prescription not found.');
  const b=req.body||{},medications=normalizeMedications(b.medications);
  if(!medications)return fail(res,400,'Provide valid medication rows for the new version.');
  const newId=crypto.randomUUID(),time=timestamp();
  db.prepare(`INSERT INTO prescriptions(id,doctor_id,patient_id,consultation_id,diagnosis,instructions,follow_up,medications,version,supersedes_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId,req.doctor.id,old.patient_id,old.consultation_id,text(b.diagnosis,1000),text(b.instructions,2000),text(b.follow_up,30),
    JSON.stringify(medications),old.version+1,old.id,time,time);
  audit(req.doctor.id,'prescription.version_created','prescription',newId);
  res.status(201).json({id:newId});
});
api.get('/prescriptions/:id/pdf',verified,canPrescribe,(req,res)=>{
  const p=db.prepare(`SELECT r.*,p.name patient_name,p.id patient_code,p.dob,p.phone,COALESCE(c.created_at,r.created_at) consultation_date FROM prescriptions r JOIN patients p ON p.id=r.patient_id
    LEFT JOIN consultations c ON c.id=r.consultation_id AND c.doctor_id=r.doctor_id
    WHERE r.id=? AND r.doctor_id=?`).get(req.params.id,req.doctor.id);
  if(!p)return fail(res,404,'Prescription not found.');
  audit(req.doctor.id,'prescription.pdf_exported','prescription',p.id);
  res.set('Content-Type','application/pdf').set('Content-Disposition',`attachment; filename="prescription-${p.id.slice(0,8)}.pdf"`);
  const pdf=new PDFDocument({margin:52});pdf.pipe(res);
  pdf.fontSize(20).text('Prescription',{align:'center'}).moveDown();
  pdf.fontSize(11).text(`Doctor: ${req.doctor.name}`).text(`Specialization: ${req.doctor.specialization}`)
    .text(`Registration: ${req.doctor.license}`).text(`${req.doctor.clinic} — ${req.doctor.clinic_address}`).moveDown()
    .text(`Patient: ${p.patient_name} (${p.patient_code})`).text(`DOB: ${p.dob}   Phone: ${p.phone}`)
    .text(`Consultation date: ${p.consultation_date.slice(0,10)}`).text(`Diagnosis: ${p.diagnosis||'—'}`).moveDown();
  pdf.fontSize(14).text('Medications').moveDown(.4).fontSize(10);
  for(const medication of JSON.parse(p.medications)){
    pdf.text(`${medication.name}${medication.strength?` (${medication.strength})`:''}`)
      .text(`Dosage: ${medication.dosage||'—'}   Route: ${medication.route||'—'}   Frequency: ${medication.frequency||'—'}   Duration: ${medication.duration||'—'}   Quantity: ${medication.quantity||'—'}`)
      .text(`Instructions: ${medication.instructions||'—'}   Precautions: ${medication.precautions||'—'}`).moveDown(.5);
  }
  pdf.moveDown().text(`Prescription instructions: ${p.instructions||'—'}`).text(`Follow-up: ${p.follow_up||'—'}`)
    .moveDown().fontSize(9).text('Recorded by the treating doctor. Verify clinical details with the prescriber.');
  pdf.end();
});

api.get('/profile',verified,(req,res)=>res.json({
  doctor:db.prepare(`SELECT id,name,dob,email,phone,license,specialization,additional_specializations,experience,clinic,clinic_address,timings,timezone,verification
    FROM doctors WHERE id=?`).get(req.doctor.id),
  availability:db.prepare('SELECT * FROM availability WHERE doctor_id=? ORDER BY weekday,start_time').all(req.doctor.id),
  blocked_dates:db.prepare('SELECT date FROM blocked_dates WHERE doctor_id=? ORDER BY date').all(req.doctor.id).map(row=>row.date)
}));
api.put('/profile',verified,(req,res)=>{
  const b=req.body||{};
  for(const key of ['name','phone','clinic','clinic_address','timings','timezone'])if(!text(b[key],500))return fail(res,400,`${key.replaceAll('_',' ')} is required.`);
  if(!validPhone(b.phone))return fail(res,400,'Enter a valid phone number.');
  if(!validTimezone(b.timezone))return fail(res,400,'Enter a valid time-zone identifier.');
  db.prepare('UPDATE doctors SET name=?,phone=?,clinic=?,clinic_address=?,timings=?,timezone=? WHERE id=?')
    .run(text(b.name,150),text(b.phone,25),text(b.clinic,180),text(b.clinic_address,500),text(b.timings,500),text(b.timezone,100),req.doctor.id);
  audit(req.doctor.id,'profile.updated','doctor',req.doctor.id);res.json({message:'Profile updated.'});
});
api.put('/availability',verified,(req,res)=>{
  const b=req.body||{};
  if(!Array.isArray(b.slots)||b.slots.length>21||!Array.isArray(b.blocked_dates)||b.blocked_dates.length>365)return fail(res,400,'Invalid availability.');
  for(const slot of b.slots){
    if(!Number.isInteger(slot.weekday)||slot.weekday<0||slot.weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.start_time)||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.end_time)||slot.start_time>=slot.end_time||!Number.isInteger(Number(slot.capacity))||slot.capacity<1||slot.capacity>30)return fail(res,400,'Check availability day, hours, and capacity.');
  }
  if(b.blocked_dates.some(date=>!validDate(date)))return fail(res,400,'Enter valid unavailable dates.');
  try {
    db.exec('BEGIN');
    db.prepare('DELETE FROM availability WHERE doctor_id=?').run(req.doctor.id);
    const insert=db.prepare('INSERT INTO availability(id,doctor_id,weekday,start_time,end_time,capacity) VALUES(?,?,?,?,?,?)');
    b.slots.forEach(slot=>insert.run(crypto.randomUUID(),req.doctor.id,slot.weekday,slot.start_time,slot.end_time,Number(slot.capacity)));
    db.prepare('DELETE FROM blocked_dates WHERE doctor_id=?').run(req.doctor.id);
    const block=db.prepare('INSERT INTO blocked_dates VALUES(?,?)');
    b.blocked_dates.forEach(date=>block.run(req.doctor.id,date));
    db.exec('COMMIT');
  } catch(error) {
    db.exec('ROLLBACK');
    throw error;
  }
  audit(req.doctor.id,'availability.updated','doctor',req.doctor.id);res.json({message:'Availability updated.'});
});
api.get('/notifications',verified,(req,res)=>{
  const current=timestamp(),future=new Date(Date.now()+86400000).toISOString();
  const due=db.prepare(`SELECT 1 FROM appointments WHERE doctor_id=? AND starts_at BETWEEN ? AND ?
    AND status NOT IN ('Cancelled','Completed','No-Show') LIMIT 1`).get(req.doctor.id,current,future);
  const reminderToday=db.prepare(`SELECT 1 FROM notifications WHERE doctor_id=? AND title='Upcoming appointment reminder'
    AND date(created_at)=date(?) LIMIT 1`).get(req.doctor.id,current);
  if(due&&!reminderToday)notify(req.doctor.id,'Upcoming appointment reminder','You have one or more upcoming appointments.');
  res.json(db.prepare('SELECT id,title,body,read,created_at FROM notifications WHERE doctor_id=? ORDER BY created_at DESC LIMIT 100').all(req.doctor.id));
});
api.patch('/notifications/:id',verified,(req,res)=>{
  const result=db.prepare('UPDATE notifications SET read=1 WHERE id=? AND doctor_id=?').run(req.params.id,req.doctor.id);
  if(!result.changes)return fail(res,404,'Notification not found.');
  res.json({message:'Notification marked as read.'});
});
api.get('/settings',verified,(req,res)=>{
  const settings=db.prepare('SELECT in_app_notifications FROM doctor_settings WHERE doctor_id=?').get(req.doctor.id);
  res.json({in_app_notifications:settings?settings.in_app_notifications===1:true});
});
api.put('/settings',verified,(req,res)=>{
  if(typeof req.body?.in_app_notifications!=='boolean')return fail(res,400,'Select whether in-app notifications are enabled.');
  db.prepare(`INSERT INTO doctor_settings(doctor_id,in_app_notifications) VALUES(?,?)
    ON CONFLICT(doctor_id) DO UPDATE SET in_app_notifications=excluded.in_app_notifications`)
    .run(req.doctor.id,req.body.in_app_notifications?1:0);
  audit(req.doctor.id,'settings.updated','doctor',req.doctor.id);res.json({message:'Notification preferences updated.'});
});

api.get('/mental-records',psychiatrist,(req,res)=>{
  audit(req.doctor.id,'mental_workspace.accessed','mental_workspace',req.doctor.id);
  res.json(db.prepare(`SELECT m.*,p.name patient_name FROM mental_records m JOIN patients p ON p.id=m.patient_id
    WHERE m.doctor_id=? ORDER BY m.updated_at DESC LIMIT 300`).all(req.doctor.id));
});
api.post('/mental-records',psychiatrist,(req,res)=>{
  const b=req.body||{};
  if(typeof b.patient_id!=='string'||!b.patient_id)return fail(res,400,'Select a patient.');
  if(!db.prepare('SELECT 1 FROM patients WHERE id=? AND doctor_id=?').get(b.patient_id,req.doctor.id))return fail(res,404,'Patient not found.');
  if(b.appointment_id&&(typeof b.appointment_id!=='string'||!db.prepare('SELECT 1 FROM appointments WHERE id=? AND doctor_id=? AND patient_id=?').get(b.appointment_id,req.doctor.id,b.patient_id)))return fail(res,400,'Appointment does not match this patient.');
  const columns=['presenting','symptoms','history','treatments','family_history','observations','assessment','goals','plan','follow_up','progress','referrals','risk'];
  const recordId=crypto.randomUUID(),time=timestamp();
  db.prepare(`INSERT INTO mental_records(id,doctor_id,patient_id,appointment_id,${columns.join(',')},created_at,updated_at)
    VALUES(?,?,?,?${',?'.repeat(columns.length+2)})`).run(recordId,req.doctor.id,b.patient_id,b.appointment_id||null,...columns.map(k=>text(b[k],3000)),time,time);
  audit(req.doctor.id,'mental_record.created','mental_record',recordId);res.status(201).json({id:recordId});
});
api.put('/mental-records/:id',psychiatrist,(req,res)=>{
  const record=db.prepare('SELECT id FROM mental_records WHERE id=? AND doctor_id=?').get(req.params.id,req.doctor.id);
  if(!record)return fail(res,404,'Mental-health record not found.');
  const columns=['presenting','symptoms','history','treatments','family_history','observations','assessment','goals','plan','follow_up','progress','referrals','risk'];
  db.prepare(`UPDATE mental_records SET ${columns.map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=? AND doctor_id=?`)
    .run(...columns.map(k=>text(req.body?.[k],3000)),timestamp(),record.id,req.doctor.id);
  audit(req.doctor.id,'mental_record.updated','mental_record',record.id);res.json({message:'Confidential record updated.'});
});

app.use('/api',api);
app.use('/api',(req,res)=>fail(res,404,'Not found.'));
app.use((error,req,res,next)=>{
  console.error('Request failed:',error.message);
  if(res.headersSent)return next(error);
  res.status(500).json({error:'The request could not be completed. Please try again.'});
});
app.listen(port,()=>console.log(`Clinical workspace listening on port ${port}`));
