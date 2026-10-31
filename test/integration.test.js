const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const scratch = path.join(os.tmpdir(), `doctor-workspace-${process.pid}`);
const verifierToken = 'local-test-verifier-token-keep-out-of-production';
let server;
let origin;
let port;

async function freePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const value = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return value;
}

async function request(url, { cookie, csrf, ...options } = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${origin}${url}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, body, cookie: response.headers.getSetCookie?.().find(value => value.startsWith('doctor_session='))?.split(';')[0] };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Server did not become ready.');
}

async function register(name, specialization, email, license) {
  const result = await request('/api/register', {
    method: 'POST',
    body: {
      name, dob: '1980-03-04', email, phone: '+1 555 555 0123', license, specialization,
      additional_specializations: [], experience: 10, clinic: 'Clinic', clinic_address: '1 Health Road',
      timings: 'Weekdays', timezone: 'UTC', password: 'correct horse battery', confirm_password: 'correct horse battery'
    }
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function signIn(email) {
  const result = await request('/api/login', {
    method: 'POST', body: { email, password: 'correct horse battery', remember: true }
  });
  assert.equal(result.response.status, 200);
  return { cookie: result.cookie, csrf: result.body.csrf };
}

async function verify(doctorId) {
  const result = await request(`/api/admin/doctors/${doctorId}/verify`, {
    method: 'POST', headers: { 'X-Verification-Token': verifierToken }, body: { status: 'verified' }
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
}

test('doctor-only clinical workflows, authorization boundaries, and SQLite persistence', async t => {
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.mkdir(scratch, { recursive: true });
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: scratch, NODE_ENV: 'test', SESSION_SECRET: 'test-session-secret-with-at-least-thirty-two-characters', VERIFICATION_ADMIN_TOKEN: verifierToken };
  server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: 'ignore' });
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await fs.rm(scratch, { recursive: true, force: true });
  });
  await waitForServer();
  const page=await fetch(origin);
  assert.equal(page.status,200);
  assert.match(await page.text(),/<title><\/title>/);

  const registered = await register('Dr. Ada Clinical', 'General Physician', 'ada@example.test', 'REG-ADA');
  assert.match(registered.message, /pending verification/i);
  const duplicate = await request('/api/register', { method:'POST', body:{
    name:'Dr. Duplicate',dob:'1980-03-04',email:'ada@example.test',phone:'+1 555 555 0123',license:'REG-OTHER',
    specialization:'General Physician',experience:1,clinic:'Clinic',clinic_address:'Address',timings:'Weekdays',
    password:'correct horse battery',confirm_password:'correct horse battery'
  } });
  assert.equal(duplicate.response.status,409);

  let doctor = await signIn('ada@example.test');
  let me = await request('/api/me', doctor);
  assert.equal(me.body.doctor.verification,'pending');
  let pendingPatients = await request('/api/patients', doctor);
  assert.equal(pendingPatients.response.status,403);
  await verify(me.body.doctor.id);
  doctor = await signIn('ada@example.test');
  me = await request('/api/me', doctor);
  assert.equal(me.body.doctor.verification,'verified');

  const csrfRejected = await request('/api/patients',{method:'POST',cookie:doctor.cookie,body:{}});
  assert.equal(csrfRejected.response.status,403);
  const missingRequired = await request('/api/patients',{method:'POST',...doctor,body:{name:'Incomplete'}});
  assert.equal(missingRequired.response.status,400);

  const patientResult = await request('/api/patients',{method:'POST',...doctor,body:{
    name:'Patient A',age:'41',phone:'+1 555 555 0101',emergency_name:'Contact A',emergency_relationship:'Sibling',
    emergency_phone:'+1 555 555 0102',house:'12',street:'Main Street',locality:'Central',city:'Town',district:'',
    state:'State',pin:'123456',country:'India',history:'Unknown / not yet verified',conditions:'',
    allergies:'No known allergies',medications:'No current medications',surgeries:'',family_history:'',notes:''
  }});
  assert.equal(patientResult.response.status,201,JSON.stringify(patientResult.body));
  assert.equal(patientResult.body.dob,'Age: 41');
  const patientId=patientResult.body.id;
  const duplicatePatient=await request('/api/patients',{method:'POST',...doctor,body:{
    name:'patient a',age:'41',phone:'+1 555 555 0101',emergency_name:'Contact A',emergency_relationship:'Sibling',
    emergency_phone:'+1 555 555 0102',house:'12',street:'Main Street',locality:'Central',city:'Town',state:'State',
    pin:'123456',country:'India',history:'Unknown',allergies:'Unknown',medications:'Unknown'
  }});
  assert.equal(duplicatePatient.response.status,409);

  const otherRegistered = await register('Dr. Bea Psychiatrist','Psychiatrist','bea@example.test','REG-BEA');
  const psychiatrist = await signIn('bea@example.test');
  const otherMe = await request('/api/me',psychiatrist);
  await verify(otherMe.body.doctor.id);
  const psychDoctor = await signIn('bea@example.test');
  const otherPatientResponse=await request('/api/patients',{method:'POST',...psychDoctor,body:{
    name:'Patient B',dob:'1990-01-01',phone:'+1 555 555 0201',emergency_name:'Contact B',emergency_relationship:'Friend',
    emergency_phone:'+1 555 555 0202',house:'1',street:'Second Street',locality:'South',city:'Town',state:'State',pin:'54321',
    country:'India',pin:'543216',history:'Unknown',conditions:'',allergies:'Unknown',medications:'Unknown'
  }});
  assert.equal(otherPatientResponse.response.status,201);
  const otherPatientId=otherPatientResponse.body.id;

  const unauthorizedPatient=await request(`/api/patients/${patientId}`,psychDoctor);
  assert.equal(unauthorizedPatient.response.status,404);
  const nonPsychMental=await request('/api/mental-records',doctor);
  assert.equal(nonPsychMental.response.status,403);
  const clinicianPsychologist=await register('Dr. Chris Psychologist','Clinical Psychologist','chris@example.test','REG-CHRIS');
  const psychologistSession=await signIn('chris@example.test');
  const psychologistMe=await request('/api/me',psychologistSession);
  await verify(psychologistMe.body.doctor.id);
  const verifiedPsychologist=await signIn('chris@example.test');
  const forbiddenPrescription=await request('/api/prescriptions',verifiedPsychologist);
  assert.equal(forbiddenPrescription.response.status,403);
  const mentalRecord=await request('/api/mental-records',{method:'POST',...psychDoctor,body:{
    patient_id:otherPatientId,presenting:'Entered by treating psychiatrist',symptoms:'',history:'',treatments:'',
    family_history:'',observations:'',assessment:'',goals:'',plan:'',follow_up:'',risk:''
  }});
  assert.equal(mentalRecord.response.status,201);

  const availabilityDate=new Date(Date.now()+3*86400000);
  availabilityDate.setUTCHours(10,0,0,0);
  const weekday=availabilityDate.getUTCDay();
  const availability=await request('/api/availability',{method:'PUT',...doctor,body:{
    slots:[{weekday,start_time:'09:00',end_time:'17:00',capacity:1}],blocked_dates:[]
  }});
  assert.equal(availability.response.status,200);
  const settingsDefault=await request('/api/settings',doctor);
  assert.equal(settingsDefault.body.in_app_notifications,true);
  const settingsUpdate=await request('/api/settings',{method:'PUT',...doctor,body:{in_app_notifications:false}});
  assert.equal(settingsUpdate.response.status,200);
  const appointmentStart=availabilityDate.toISOString();
  const appointment=await request('/api/appointments',{method:'POST',...doctor,body:{
    patient_id:patientId,starts_at:appointmentStart,duration:30,mode:'In-Person',reason:'Review',notes:''
  }});
  assert.equal(appointment.response.status,201,JSON.stringify(appointment.body));
  const overlap=await request('/api/appointments',{method:'POST',...doctor,body:{
    patient_id:patientId,starts_at:new Date(availabilityDate.getTime()+15*60000).toISOString(),duration:30,mode:'In-Person',reason:'Review',notes:''
  }});
  assert.equal(overlap.response.status,409);
  const outsideHours=await request('/api/appointments',{method:'POST',...doctor,body:{
    patient_id:patientId,starts_at:new Date(availabilityDate.getTime()+9*60*60000).toISOString(),duration:30,mode:'Online',reason:'Review',notes:''
  }});
  assert.equal(outsideHours.response.status,409);
  const atCapacity=await request('/api/appointments',{method:'POST',...doctor,body:{
    patient_id:patientId,starts_at:new Date(availabilityDate.getTime()+60*60000).toISOString(),duration:30,mode:'Online',reason:'Review',notes:''
  }});
  assert.equal(atCapacity.response.status,409);
  const rescheduled=await request(`/api/appointments/${appointment.body.id}`,{method:'PATCH',...doctor,body:{
    starts_at:new Date(availabilityDate.getTime()+60*60000).toISOString(),duration:45,mode:'Online',reason:'Rescheduled',notes:''
  }});
  assert.equal(rescheduled.response.status,200);

  const consultation=await request('/api/consultations',{method:'POST',...doctor,body:{
    patient_id:patientId,appointment_id:appointment.body.id,complaint:'Recorded by doctor',symptoms:'',history:'',findings:'',
    diagnosis:'',plan:'',notes:'',follow_up:''
  }});
  assert.equal(consultation.response.status,201);
  const finalizedConsult=await request(`/api/consultations/${consultation.body.id}`,{method:'PATCH',...doctor,body:{
    complaint:'Recorded by doctor',finalize:true
  }});
  assert.equal(finalizedConsult.response.status,200);
  const immutable=await request(`/api/consultations/${consultation.body.id}`,{method:'PATCH',...doctor,body:{complaint:'Rewrite'}});
  assert.equal(immutable.response.status,409);
  const amendment=await request(`/api/consultations/${consultation.body.id}`,{method:'PATCH',...doctor,body:{
    amendment_reason:'Correction documented',complaint:'Corrected complaint'
  }});
  assert.equal(amendment.response.status,200);
  const consultationHistory=await request(`/api/consultations/${consultation.body.id}`,doctor);
  assert.equal(consultationHistory.body.consultation.complaint,'Recorded by doctor');
  assert.equal(consultationHistory.body.amendments.length,1);

  const prescription=await request('/api/prescriptions',{method:'POST',...doctor,body:{
    patient_id:patientId,consultation_id:consultation.body.id,diagnosis:'Recorded diagnosis',instructions:'As documented',
    follow_up:'',medications:[{name:'Medicine entered by doctor'}]
  }});
  assert.equal(prescription.response.status,201);
  const incompleteFinalization=await request(`/api/prescriptions/${prescription.body.id}`,{method:'PATCH',...doctor,body:{
    diagnosis:'Recorded diagnosis',instructions:'As documented',follow_up:'',medications:[{name:'Medicine entered by doctor'}],finalize:true
  }});
  assert.equal(incompleteFinalization.response.status,400);
  const savePrescriptionDraft=await request(`/api/prescriptions/${prescription.body.id}`,{method:'PATCH',...doctor,body:{
    diagnosis:'Recorded diagnosis',instructions:'As documented',follow_up:'',
    medications:[{name:'Medicine entered by doctor',strength:'10 mg',dosage:'One tablet',route:'Oral',frequency:'Daily',duration:'5 days',quantity:'5',instructions:'After food',precautions:'Review allergies'}],finalize:false
  }});
  assert.equal(savePrescriptionDraft.response.status,200);
  const finalPrescription=await request(`/api/prescriptions/${prescription.body.id}`,{method:'PATCH',...doctor,body:{
    diagnosis:'Recorded diagnosis',instructions:'As documented',follow_up:'',medications:[{name:'Medicine entered by doctor',strength:'10 mg',dosage:'One tablet',route:'Oral',frequency:'Daily',duration:'5 days',quantity:'5',instructions:'After food',precautions:'Review allergies'}],finalize:true
  }});
  assert.equal(finalPrescription.response.status,200);
  const immutablePrescription=await request(`/api/prescriptions/${prescription.body.id}`,{method:'PATCH',...doctor,body:{
    diagnosis:'Changed',instructions:'',follow_up:'',medications:[{name:'Changed'}],finalize:true
  }});
  assert.equal(immutablePrescription.response.status,409);
  const pdf=await request(`/api/prescriptions/${prescription.body.id}/pdf`,doctor);
  assert.equal(pdf.response.status,200);
  assert.ok(Buffer.isBuffer(pdf.body)&&pdf.body.subarray(0,4).toString()==='%PDF');

  const patientReload=await request(`/api/patients/${patientId}`,doctor);
  assert.equal(patientReload.response.status,200);
  assert.equal(patientReload.body.patient.emergency_phone,'+1 555 555 0102');
  const logout=await request('/api/logout',{method:'POST',...doctor,body:{}});
  assert.equal(logout.response.status,200);
  const afterLogout=await request('/api/patients',doctor);
  assert.equal(afterLogout.response.status,401);

  server.kill();
  await once(server,'exit');
  port=await freePort();
  origin=`http://127.0.0.1:${port}`;
  env.PORT=String(port);
  server=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env,stdio:'ignore'});
  await waitForServer();
  const restoredDoctor=await signIn('ada@example.test');
  const persisted=await request('/api/patients',restoredDoctor);
  assert.equal(persisted.response.status,200);
  assert.ok(persisted.body.some(patient=>patient.id===patientId));
  const passwordChange=await request('/api/password',{method:'PUT',...restoredDoctor,body:{
    current_password:'correct horse battery',new_password:'a new and safer password'
  }});
  assert.equal(passwordChange.response.status,200);
  const oldPassword=await request('/api/login',{method:'POST',body:{email:'ada@example.test',password:'correct horse battery'}});
  assert.equal(oldPassword.response.status,401);
  const newPassword=await request('/api/login',{method:'POST',body:{email:'ada@example.test',password:'a new and safer password'}});
  assert.equal(newPassword.response.status,200);
  assert.match(otherRegistered.message,/pending verification/i);
  assert.match(clinicianPsychologist.message,/pending verification/i);
  assert.ok(Number.isInteger(weekday));
});
