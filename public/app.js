(() => {
  const app = document.querySelector('#app');
  const toastRegion = document.querySelector('#toast-region');
  const weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const specializations = ['General Physician','Cardiologist','Dermatologist','Neurologist','Psychiatrist','Clinical Psychologist','Pediatrician','Orthopedic Specialist','Gynecologist','Ophthalmologist','ENT Specialist','Pulmonologist','Gastroenterologist','Endocrinologist','Nephrologist','Oncologist','Dentist','Urologist','Other'];
  const state = { doctor:null, csrf:'', page:'dashboard', patients:[], appointments:[], consultations:[], prescriptions:[], mentalRecords:[], selectedPatient:null, patientData:null, prescriptionPatient:null, prescriptionContextId:null, settings:null, patientQuery:'', appointmentStatus:'', calendarDate:new Date(), calendarMode:'week', consultationDraft:null, consultationDetail:null, prescriptionDraft:null, medicineCount:0 };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const initials = value => String(value || '').trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase() || 'D';
  const dateLabel = value => value ? (String(value).startsWith('Age: ') ? String(value) : new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric'}).format(new Date(value))) : '—';
  const timeLabel = value => value ? new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(value)) : '—';
  const dateTimeLabel = value => value ? `${dateLabel(value)} · ${timeLabel(value)}` : '—';
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const localDateTime = date => `${dayKey(date)}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  const titleCase = value => String(value || '').replaceAll('_',' ').replace(/\b\w/g, ch=>ch.toUpperCase());
  const statusClass = value => `status-${String(value||'').toLowerCase().replaceAll(' ','-')}`;
  const field = (label,name,{type='text',required=false,markRequired=false,placeholder='',value='',options=null,full=false,help='',min='',max='',step='',readonly=false,autoComplete=''}={}) => {
    const control = options
      ? `<select id="${esc(name)}" name="${esc(name)}" ${required?'required':''} ${readonly?'disabled':''}><option value="">Select…</option>${options.map(option=>`<option value="${esc(option.value)}" ${String(value)===String(option.value)?'selected':''}>${esc(option.label)}</option>`).join('')}</select>`
      : type==='textarea'
        ? `<textarea id="${esc(name)}" name="${esc(name)}" ${required?'required':''} placeholder="${esc(placeholder)}" ${readonly?'readonly':''}>${esc(value)}</textarea>`
        : type==='password'
          ? `<div class="password-wrap"><input id="${esc(name)}" name="${esc(name)}" type="password" ${required?'required':''} autocomplete="${esc(autoComplete)}" placeholder="${esc(placeholder)}" value="${esc(value)}"><button type="button" data-action="toggle-password" data-for="${esc(name)}" aria-label="Show ${esc(label)}" aria-pressed="false">Show</button></div>`
          : `<input id="${esc(name)}" name="${esc(name)}" type="${esc(type)}" ${required?'required':''} placeholder="${esc(placeholder)}" value="${esc(value)}" ${min?`min="${esc(min)}"`:''} ${max?`max="${esc(max)}"`:''} ${step?`step="${esc(step)}"`:''} ${readonly?'readonly':''}>`;
    return `<div class="field ${full?'span-2':''}"><label for="${esc(name)}">${esc(label)}${required||markRequired?' <span class="req">*</span>':''}</label>${control}${help?`<small>${esc(help)}</small>`:''}<span class="field-error" data-error="${esc(name)}"></span></div>`;
  };
  const section = label => `<div class="section-title">${esc(label)}</div>`;
  const btn = (label,action,kind='btn-outline',extra='') => `<button type="button" class="btn ${kind} ${extra}" data-action="${esc(action)}">${esc(label)}</button>`;
  const badge = value => `<span class="status ${statusClass(value)}">${esc(value||'Unknown')}</span>`;
  const empty = (title,description,icon='◇') => `<div class="empty"><div class="empty-icon">${icon}</div><strong>${esc(title)}</strong><span>${esc(description)}</span></div>`;
  const initialsAvatar = name => `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;
  const isPsychiatrist = () => state.doctor?.specialization === 'Psychiatrist' && state.doctor?.verification === 'verified';
  const hasPrescriptionAccess = () => state.doctor?.specialization !== 'Clinical Psychologist';

  async function api(url,options={}) {
    const headers = {...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers||{})};
    if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
    let response;
    try { response = await fetch(`/api${url}`,{credentials:'same-origin',...options,headers}); }
    catch { const error=new Error('Unable to reach the server. Check your connection and retry.');showRequestError(error.message);throw error; }
    const contentType=response.headers.get('content-type')||'';
    if(!response.ok) {
      const payload=contentType.includes('application/json')?await response.json():{};
      if(response.status===401 && state.doctor){state.doctor=null;state.csrf='';render();}
      const error=new Error(payload.error||'The request could not be completed.');
      if(response.status>=500)showRequestError(error.message);
      throw error;
    }
    document.querySelector('#page-content .request-error-banner')?.remove();
    return contentType.includes('application/json')?response.json():response;
  }
  function showRequestError(message) {
    const page=document.querySelector('#page-content');
    if(!page)return;
    page.querySelector('.request-error-banner')?.remove();
    const banner=document.createElement('div');
    banner.className='verification request-error-banner';
    const text=document.createElement('div');
    text.textContent=`Could not load data: ${message}`;
    const retry=document.createElement('button');
    retry.type='button';retry.className='btn btn-outline btn-small';retry.dataset.action='retry-current';retry.textContent='Retry';
    banner.append(text,retry);page.prepend(banner);
  }
  function toast(message,error=false) {
    const element=document.createElement('div');element.className=`toast${error?' error':''}`;element.textContent=message;toastRegion.append(element);
    window.setTimeout(()=>element.remove(),4200);
  }
  function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
  function setFieldError(form,name,message) {
    const error=form.querySelector(`[data-error="${name}"]`);
    const container=error?.closest('.field');
    if(error)error.textContent=message;
    container?.classList.toggle('invalid',Boolean(message));
  }
  function heading(title,subtitle,actions='') {
    return `<div class="page-heading"><div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${actions?`<div class="heading-actions">${actions}</div>`:''}</div>`;
  }
  function buttonAction(label,action,kind='btn-primary') { return `<button class="btn ${kind}" type="button" data-action="${esc(action)}">${esc(label)}</button>`; }
  function spinner(text='Loading…') { return `<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`; }

  function authView(register=false) {
    app.innerHTML=`<main class="auth-page">
      <section class="auth-aside"><div class="auth-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s8-3.8 8-10V5l-8-3-8 3v6c0 6.2 8 10 8 10Z"/><path d="M12 8v8M8 12h8"/></svg></div>
        <h1>A calmer place for clinical work.</h1><p>One secure workspace for your patients, appointments and clinical records.</p>
        <ul class="auth-bullets"><li><span class="checkmark">✓</span> Doctor-only access</li><li><span class="checkmark">✓</span> Your own patients and schedule</li><li><span class="checkmark">✓</span> Records remain under your care</li></ul>
      </section>
      <section class="auth-main"><div class="auth-box">
        <div class="eyebrow">DOCTOR ACCESS</div><h2>${register?'Create your account':'Welcome back'}</h2>
        <p class="intro">${register?'Register your professional profile. Clinical access will remain pending until your credentials are verified.':'Sign in to your clinical workspace.'}</p>
        <div id="auth-message" aria-live="polite"></div>
        ${register?`<form id="register-form" class="form-grid">
          ${field('Full name','name',{required:true,full:true,autocomplete:'name'})}
          ${field('Date of birth','dob',{type:'date',required:true})}
          ${field('Email address','email',{type:'email',required:true})}
          ${field('Phone number','phone',{type:'tel',required:true})}
          ${field('Medical registration / license number','license',{required:true,full:true})}
          ${field('Primary specialization','specialization',{required:true,options:specializations.map(x=>({value:x,label:x})),full:true})}
          ${field('Additional specializations','additional_specializations',{type:'text',placeholder:'Separate by commas',full:true,help:'Optional. Your primary specialty is saved separately.'})}
          ${field('Years of experience','experience',{type:'number',required:true,min:0,max:80})}
          ${field('Hospital / clinic name','clinic',{required:true})}
          ${field('Clinic address','clinic_address',{required:true,full:true})}
          ${field('Consultation timings','timings',{required:true,placeholder:'For example, weekdays 09:00–17:00',full:true})}
          ${field('Clinic time zone','timezone',{value:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata',help:'IANA identifier used for calendar availability.' ,full:true})}
          ${field('Password','password',{type:'password',required:true,autoComplete:'new-password',help:'Use at least 12 characters.'})}
          ${field('Confirm password','confirm_password',{type:'password',required:true,autoComplete:'new-password'})}
          <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">Submit registration</button></div>
        </form>`:`<form id="login-form">
          ${field('Email address','email',{type:'email',required:true,placeholder:'you@clinic.com'})}
          ${field('Password','password',{type:'password',required:true,autoComplete:'current-password'})}
          <label class="checkbox-row"><input type="checkbox" name="remember"> Remember me on this device</label>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Sign in</button></div>
          <p class="auth-switch"><button class="text-button" type="button" data-action="forgot">Forgot password?</button></p>
        </form>`}
        <p class="auth-switch">${register?'Already registered?':'First time here?'} <button class="text-button" type="button" data-action="${register?'show-login':'show-register'}">${register?'Sign in':'Create a doctor account'}</button></p>
      </div></section></main>`;
  }

  function shell(content) {
    const workspaceNavigation=[
      ['dashboard','◫','Dashboard'],['patients','♙','My Patients'],['appointments','▦','Appointments'],['consultations','▤','Consultations'],
      ...(hasPrescriptionAccess()?[['prescriptions','℞','Prescriptions']]:[]),['records','▧','Medical Records']
    ];
    const accountNavigation=[['notifications','♧','Notifications'],['profile','◉','My Profile'],['settings','⚙','Settings']];
    const pageTitles={dashboard:'Dashboard',patients:'My Patients',appointments:'Appointments',consultations:'Consultations',prescriptions:'Prescriptions',records:'Medical Records',mental:'Mental Health Workspace',notifications:'Notifications',profile:'My Profile',settings:'Settings',patient:'Patient record',newpatient:'Add patient',appointmentForm:'Schedule appointment',consultationForm:'Consultation',prescriptionForm:'Prescription'};
    app.innerHTML=`<div class="app-shell">
      <div class="mobile-backdrop" data-action="close-menu"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand-space" aria-hidden="true"></div>
        <div class="doctor-mini">${initialsAvatar(state.doctor?.name)}<div><strong>${esc(state.doctor?.name)}</strong><small>${esc(state.doctor?.specialization)}</small></div></div>
        <div class="nav-label">Workspace</div><nav class="nav" aria-label="Main navigation">${workspaceNavigation.map(([id,icon,label])=>`<button type="button" class="${state.page===id?'active':''}" data-page="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
          ${isPsychiatrist()?`<div class="nav-label">Specialty</div><button type="button" class="${state.page==='mental'?'active':''}" data-page="mental"><span class="nav-icon">◌</span>Mental Health Workspace</button>`:''}
          <div class="nav-label">Account</div>${accountNavigation.map(([id,icon,label])=>`<button type="button" class="${state.page===id?'active':''}" data-page="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
        </nav>
        <div class="nav-bottom"><button type="button" class="nav nav-logout" data-action="logout">↪ &nbsp; Sign out</button></div>
      </aside>
      <div class="main-wrap"><header class="topbar"><div class="topbar-left"><button class="mobile-menu" data-action="open-menu" aria-label="Open navigation">☰</button><strong>${esc(pageTitles[state.page]||'Workspace')}</strong><span class="topbar-date">${new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date())}</span></div>
        <div class="top-actions"><span class="small muted">${esc(state.doctor?.specialization||'')}</span>${badge(state.doctor?.verification)}</div></header><main class="page" id="page-content">${content}</main></div>
    </div>`;
  }
  function pendingView() {
    return `${heading(`Welcome, ${state.doctor.name}`,'Your registration has been received. Credential verification is required before clinical workspace access.') }
      <div class="verification"><div aria-hidden="true">◷</div><div><strong>Verification pending</strong><p>Your medical registration details are awaiting review. Patient records and clinical tools stay locked until an authorized credential verifier confirms your professional role.</p></div></div>
      <section class="card"><div class="card-heading"><div><h2>Professional profile</h2><p>Submitted during registration</p></div></div>
       <div class="detail-grid"><div class="detail-item"><span>Name</span><strong>${esc(state.doctor.name)}</strong></div><div class="detail-item"><span>Specialization</span><strong>${esc(state.doctor.specialization)}</strong></div><div class="detail-item"><span>Registration</span><strong>${esc(state.doctor.license)}</strong></div><div class="detail-item"><span>Clinic</span><strong>${esc(state.doctor.clinic)}</strong></div></div>
       <p class="form-note pending-help">Signing in does not itself verify credentials. Contact your clinic administrator if you need help with the review.</p>
      </section>`;
  }
  function render() {
    if(!state.doctor){authView(false);return;}
    if(state.doctor.verification!=='verified'){shell(pendingView());return;}
    const content=state.page==='dashboard'?dashboardView():state.page==='patients'?patientsView():
      state.page==='patient'?patientView():state.page==='newpatient'?patientFormView():
      state.page==='appointments'?appointmentsView():state.page==='appointmentForm'?appointmentFormView():
      state.page==='consultations'?consultationsView():state.page==='consultationReview'?consultationReviewView():state.page==='consultationForm'?consultationFormView():
      state.page==='prescriptions'?hasPrescriptionAccess()?prescriptionsView():`${heading('Prescriptions','This module is not enabled for the verified professional role on this account.')}${empty('Access restricted','Prescription access is unavailable for this professional role.','℞')}`:state.page==='prescriptionForm'?hasPrescriptionAccess()?prescriptionFormView():`${heading('Prescriptions','Access is restricted.')}${empty('Access restricted','Prescription access is unavailable for this professional role.','℞')}`:
      state.page==='records'?recordsView():state.page==='mental'?mentalView():
      state.page==='notifications'?notificationsView():state.page==='profile'?profileView():state.page==='settings'?settingsView():dashboardView();
    shell(content);
  }
  function loadDashboard() {
    api('/dashboard').then(data=>{state.dashboard=data;if(state.page==='dashboard')render();}).catch(error=>toast(error.message,true));
  }
  function dashboardView() {
    if(!state.dashboard){loadDashboard();return spinner('Loading your practice summary…');}
    const d=state.dashboard;
    const stats=[
      ['Registered patients',d.patient_count,'♙','Across your records'],
      ["Today's appointments",d.today_appointments.length,'▦','Scheduled for today'],
      ['Upcoming appointments',d.upcoming_count,'◷','Next on your calendar'],
      ['Pending appointments',d.totals.pending,'◷','Awaiting completion'],
      ['Completed consultations',d.totals.completed,'✓','All time'],
      ['Cancelled appointments',d.totals.cancelled,'↶','Retained in history']
    ];
    const todayRows=d.today_appointments;
    return `${heading(`Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, ${state.doctor.name}`,
      `${state.doctor.specialization} · ${dateLabel(new Date())}`,
      `${buttonAction('Add patient','new-patient','btn-outline')}${buttonAction('Schedule appointment','new-appointment','btn-primary')}${hasPrescriptionAccess()?buttonAction('Create prescription','new-prescription','btn-soft'):''}`)}
      <div class="stats-grid">${stats.map(([label,value,icon,sub])=>`<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${Number(value)||0}</div><div class="stat-sub">${esc(sub)}</div></article>`).join('')}</div>
      <div class="dashboard-grid"><section class="card"><div class="card-heading"><div><h2>Today's appointments</h2><p>Your schedule for today</p></div><button class="text-button" data-page="appointments">View all</button></div>
        ${todayRows.length?`<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Time</th><th>Visit</th><th>Status</th><th></th></tr></thead><tbody>${todayRows.map(a=>`<tr><td class="patient-cell">${esc(a.patient_name)}</td><td>${timeLabel(a.starts_at)}</td><td>${esc(a.mode)}</td><td>${badge(a.status)}</td><td><button class="btn btn-soft btn-small" data-action="open-patient" data-id="${esc(a.patient_id)}">Open</button></td></tr>`).join('')}</tbody></table></div>`:empty('No appointments today','When you schedule visits, they will appear here.','▦')}
      </section><section class="card"><div class="card-heading"><div><h2>Coming up</h2><p>Your next scheduled visits</p></div></div>
       ${d.upcoming.length?d.upcoming.slice(0,5).map(a=>`<div class="record-row"><div class="record-row-head"><strong>${esc(a.patient_name)}</strong>${badge(a.status)}</div><p>${dateTimeLabel(a.starts_at)}${a.reason?` · ${esc(a.reason)}`:''}</p></div>`).join(''):empty('Nothing scheduled yet','Your upcoming appointments will appear here.','◷')}
      </section><section class="card"><div class="card-heading"><div><h2>Recent activity</h2><p>Latest updates in your workspace</p></div></div>
        ${d.recent_activity.length?d.recent_activity.map(entry=>`<div class="record-row"><strong>${esc(titleCase(entry.action))}</strong><p>${esc(titleCase(entry.entity))} · ${dateTimeLabel(entry.created_at)}</p></div>`).join(''):empty('No activity yet','Your clinical workspace activity will appear here.','◷')}
      </section></div>`;
  }
  function patientsView() {
    if(!state.patientListLoaded){state.patientListLoaded=true;api(`/patients?q=${encodeURIComponent(state.patientQuery)}`).then(rows=>{state.patients=rows;if(state.page==='patients')render();}).catch(error=>toast(error.message,true));}
    const rows=state.patients;
    return `${heading('My Patients','Your patient records and clinical histories.',buttonAction('Add patient','new-patient'))}
      <section class="card list-card"><div class="card-heading"><div><h2>Patient directory</h2><p>${rows.length} ${rows.length===1?'patient':'patients'}</p></div></div>
      <form class="toolbar" id="patient-search"><input name="q" type="search" value="${esc(state.patientQuery)}" placeholder="Search name, phone or patient ID" aria-label="Search patients"><button class="btn btn-outline" type="submit">Search</button></form>
      ${rows.length?`<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Patient ID</th><th>Date of birth</th><th>Phone</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map(p=>`<tr><td class="patient-cell">${esc(p.name)}</td><td>${esc(p.id)}</td><td>${dateLabel(p.dob)}</td><td>${esc(p.phone)}</td><td>${dateLabel(p.updated_at)}</td><td><button class="btn btn-soft btn-small" data-action="open-patient" data-id="${esc(p.id)}">View record</button></td></tr>`).join('')}</tbody></table></div>`:empty(state.patientQuery?'No matching patients':'No patient records yet',state.patientQuery?'Try another name, phone number or patient ID.':'Add a patient to begin building your practice records.','♙')}</section>`;
  }
  function patientFormView() {
    const p=state.editPatient||{};
    const knownOptions=(selected,label)=>[{value:'Unknown / not yet verified',label:'Unknown / not yet verified'},{value:`No known ${label}`,label:`No known ${label}`},{value:selected||'',label:selected||'Record details'}].filter((item,index,array)=>item.value&&array.findIndex(x=>x.value===item.value)===index);
    return `${heading(state.editPatient?'Edit patient record':'Add patient','Required fields are marked with an asterisk.',buttonAction('Back to patients','patients','btn-outline'))}
      <form id="patient-form" class="card form-grid">
      ${section('Personal details')}
      ${field('Full name','name',{required:true,value:p.name})}
      <div class="span-2 form-note birth-requirement">Date of birth or age <span class="req">*</span> is required; enter either value.</div>
      ${field('Date of birth','dob',{type:'date',value:p.dob?.startsWith('Age: ')?'':p.dob,help:'Enter date of birth or age below.'})}
      ${field('Age (if date of birth is unknown)','age',{type:'number',min:0,max:130,value:p.dob?.startsWith('Age: ')?p.dob.slice(5):'',help:'One of date of birth or age is required.'})}
      ${field('Phone number','phone',{type:'tel',required:true,value:p.phone,help:'Include country code when available.'})}
      ${field('Email address','email',{type:'email',value:p.email})}
      ${section('Emergency contact — required')}
      ${field('Contact full name','emergency_name',{required:true,value:p.emergency_name})}
      ${field('Relationship to patient','emergency_relationship',{required:true,value:p.emergency_relationship})}
      ${field('Contact phone number','emergency_phone',{type:'tel',required:true,value:p.emergency_phone})}
      ${section('Residential address — required')}
      ${field('House / door number','house',{required:true,value:p.house})}${field('Street name','street',{required:true,value:p.street})}
      ${field('Area / locality','locality',{required:true,value:p.locality})}${field('City / town','city',{required:true,value:p.city})}
      ${field('District','district',{value:p.district})}${field('State','state',{required:true,value:p.state})}
      ${field('PIN / postal code','pin',{required:true,value:p.pin})}${field('Country','country',{required:true,value:p.country||''})}
      ${section('Medical information')}
      ${field('Medical history','history',{type:'textarea',required:true,value:p.history,placeholder:'Record known history, or explicitly select a status.'})}
      ${field('Existing conditions','conditions',{type:'textarea',value:p.conditions})}
      ${field('Known allergies','allergies',{type:'textarea',required:true,value:p.allergies,placeholder:'Record allergies, “No known allergies”, or unknown.'})}
      ${field('Current medications','medications',{type:'textarea',required:true,value:p.medications,placeholder:'Record medications, “No current medications”, or unknown.'})}
      ${field('Previous surgeries','surgeries',{type:'textarea',value:p.surgeries})}
      ${field('Family medical history','family_history',{type:'textarea',value:p.family_history})}
      ${field('Additional clinical notes','notes',{type:'textarea',value:p.notes,full:true})}
      <div class="span-2 notice">Clinical facts are entered by you. Mark information unknown when it has not been verified; do not infer or auto-fill medical details.</div>
      <div class="span-2 form-actions"><button type="button" class="btn btn-outline" data-action="${state.editPatient?'open-patient':'patients'}">Cancel</button><button class="btn btn-primary" type="submit">${state.editPatient?'Save changes':'Save patient record'}</button></div>
      </form>`;
  }
  function patientView() {
    if(!state.patientData){api(`/patients/${encodeURIComponent(state.selectedPatient)}`).then(data=>{state.patientData=data;if(state.page==='patient')render();}).catch(error=>toast(error.message,true));return spinner('Loading patient record…');}
    const {patient:p,appointments,consultations,prescriptions}=state.patientData;
    return `${heading(p.name,`Patient ID ${p.id}`,`${buttonAction('Edit record','edit-patient','btn-outline')}${buttonAction('Schedule visit','new-appointment')}`)}
      <div class="patient-layout"><section class="card"><div class="patient-detail-top">${initialsAvatar(p.name)}<div><h2>${esc(p.name)}</h2><p class="muted small">${esc(p.phone)}</p></div></div>
      <div class="detail-block"><h3>Personal details</h3><div class="detail-grid"><div class="detail-item"><span>Date of birth / age</span><strong>${esc(p.dob)}</strong></div><div class="detail-item"><span>Email</span><strong>${esc(p.email||'Not recorded')}</strong></div></div></div>
      <div class="detail-block"><h3>Emergency contact</h3><div class="detail-grid"><div class="detail-item"><span>Name & relationship</span><strong>${esc(p.emergency_name)} · ${esc(p.emergency_relationship)}</strong></div><div class="detail-item"><span>Phone</span><strong>${esc(p.emergency_phone)}</strong></div></div></div>
      <div class="detail-block"><h3>Residential address</h3><div class="med-history">${esc([p.house,p.street,p.locality,p.city,p.district,p.state,p.pin,p.country].filter(Boolean).join(', '))}</div></div>
      <div class="detail-block"><h3>Allergies</h3><div class="med-history">${esc(p.allergies)}</div></div><div class="detail-block"><h3>Current medications</h3><div class="med-history">${esc(p.medications)}</div></div>
      <div class="detail-block"><h3>Medical history</h3><div class="med-history">${esc(p.history)}</div></div><div class="detail-block"><h3>Conditions & surgeries</h3><div class="med-history">${esc([p.conditions,p.surgeries].filter(Boolean).join('\n')||'Not recorded')}</div></div>
      <div class="detail-block"><h3>Family history & notes</h3><div class="med-history">${esc([p.family_history,p.notes].filter(Boolean).join('\n')||'Not recorded')}</div></div>
      </section><section class="card"><div class="tabs" role="tablist"><button class="active" data-patient-tab="appointments">Appointments (${appointments.length})</button><button data-patient-tab="consultations">Consultations (${consultations.length})</button><button data-patient-tab="prescriptions">Prescriptions (${prescriptions.length})</button></div>
      <div id="patient-record-tab">${patientHistoryTab('appointments')}</div>
      <div class="form-actions">${buttonAction('New consultation','new-consultation','btn-soft')}${buttonAction('Schedule follow-up','schedule-follow-up','btn-outline')}${hasPrescriptionAccess()?buttonAction('Create prescription','new-prescription','btn-outline'):''}</div></section></div>`;
  }
  function patientHistoryTab(tab) {
    const source=state.patientData||{};
    const rows=source[tab]||[];
    if(!rows.length)return empty(`No ${tab} yet`,`${titleCase(tab)} recorded for this patient will appear here.`,'◇');
    if(tab==='appointments')return rows.map(a=>`<article class="record-row"><div class="record-row-head"><strong>${dateTimeLabel(a.starts_at)}</strong>${badge(a.status)}</div><p>${esc(a.mode)} · ${esc(a.reason||'No reason recorded')}</p></article>`).join('');
    if(tab==='consultations')return rows.map(r=>`<article class="record-row"><div class="record-row-head"><strong>${dateLabel(r.created_at)}</strong>${badge(r.status)}</div><p>${esc(r.complaint||r.diagnosis||'Consultation record')}</p><p>${esc(r.diagnosis||'Diagnosis not recorded')}</p></article>`).join('');
    return rows.map(r=>`<article class="record-row"><div class="record-row-head"><strong>${dateLabel(r.created_at)} · Version ${r.version}</strong>${badge(r.status)}</div><p>${esc(r.diagnosis||'Diagnosis not recorded')}</p><div class="heading-actions">${buttonAction('Export PDF',`download-prescription:${r.id}`,'btn-outline btn-small')}</div></article>`).join('');
  }

  function appointmentsView() {
    if(!state.appointmentListLoaded){state.appointmentListLoaded=true;api(`/appointments?status=${encodeURIComponent(state.appointmentStatus)}`).then(rows=>{state.appointments=rows;if(state.page==='appointments')render();}).catch(error=>toast(error.message,true));}
    const rows=state.appointments;
    const filterOptions=['','Scheduled','Confirmed','In Progress','Completed','Cancelled','No-Show'];
    return `${heading('Appointments','Manage your schedule, status and follow-up visits.',buttonAction('Schedule appointment','new-appointment'))}
      <section class="card"><div class="card-heading"><div><h2>Calendar</h2><p>Appointments are shown in your browser’s local time.</p></div><div class="calendar-header"><button class="btn btn-outline btn-small" data-action="calendar-prev" aria-label="Previous period">‹</button><h2>${calendarLabel()}</h2><button class="btn btn-outline btn-small" data-action="calendar-next" aria-label="Next period">›</button></div></div>
      <div class="toolbar"><select id="calendar-mode" aria-label="Calendar view"><option value="day" ${state.calendarMode==='day'?'selected':''}>Day</option><option value="week" ${state.calendarMode==='week'?'selected':''}>Week</option><option value="month" ${state.calendarMode==='month'?'selected':''}>Month</option></select><button class="btn btn-outline btn-small" data-action="calendar-today">Today</button><select id="appointment-filter" aria-label="Filter appointments">${filterOptions.map(x=>`<option value="${esc(x)}" ${state.appointmentStatus===x?'selected':''}>${x||'All statuses'}</option>`).join('')}</select><input type="search" id="appointment-search" placeholder="Search patient, ID or reason" aria-label="Search appointments"></div>
      ${calendarMarkup()}</section>
      <section class="card list-card spaced-top"><div class="card-heading"><div><h2>Appointment history</h2><p>${rows.length} records · cancelled visits remain in history</p></div></div>
      ${rows.length?`<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Date & time</th><th>Reason</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(a=>`<tr data-appointment-row><td class="patient-cell">${esc(a.patient_name)}</td><td>${dateTimeLabel(a.starts_at)}<br><span class="muted small">${a.duration} min</span></td><td>${esc(a.reason||'—')}</td><td>${esc(a.mode)}</td><td>${badge(a.status)}</td><td><div class="table-actions">${a.status!=='Cancelled'&&a.status!=='Completed'?`<select class="inline-control appointment-status-select" data-appointment-status="${esc(a.id)}" aria-label="Update appointment status"><option value="">Update status</option>${['Confirmed','In Progress','Completed','Cancelled','No-Show'].map(s=>`<option>${s}</option>`).join('')}</select>${buttonAction('Reschedule',`reschedule:${a.id}`,'btn-outline btn-small')}`:''}${a.status==='Completed'?buttonAction('Consultation',`appointment-consultation:${a.patient_id}:${a.id}`,'btn-soft btn-small'):''}${buttonAction('Patient',`open-patient:${a.patient_id}`,'btn-outline btn-small')}</div></td></tr>`).join('')}</tbody></table></div>`:empty('No appointments found','Schedule an appointment to see it here.','▦')}</section>`;
  }
  function calendarLabel() {
    const d=state.calendarDate;
    if(state.calendarMode==='day')return new Intl.DateTimeFormat(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric'}).format(d);
    if(state.calendarMode==='month')return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(d);
    const start=new Date(d);start.setDate(d.getDate()-((d.getDay()+6)%7));
    const end=new Date(start);end.setDate(start.getDate()+6);
    return `${dateLabel(start)} — ${dateLabel(end)}`;
  }
  function calendarMarkup() {
    const first=state.calendarMode==='month'?new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth(),1):new Date(state.calendarDate);
    if(state.calendarMode==='week'||state.calendarMode==='month')first.setDate(first.getDate()-((first.getDay()+6)%7));
    const days=state.calendarMode==='day'?1:state.calendarMode==='week'?7:42;
    const headings=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const visibleHeadings=state.calendarMode==='day'?[new Intl.DateTimeFormat(undefined,{weekday:'long'}).format(first)]:headings;
    return `<div class="calendar" aria-label="${state.calendarMode} appointment calendar">${visibleHeadings.map(day=>`<div class="cal-day cal-head">${day}</div>`).join('')}${Array.from({length:days},(_,index)=>{
      const date=new Date(first);date.setDate(first.getDate()+index);
      const currentMonth=date.getMonth()===state.calendarDate.getMonth();
      const events=state.appointments.filter(a=>dayKey(new Date(a.starts_at))===dayKey(date)&&a.status!=='Cancelled');
      return `<div class="cal-day ${currentMonth?'':'cal-empty'}"><div class="cal-date">${date.getDate()}${state.calendarMode==='month'&&!currentMonth?'<span class="calendar-empty-label"> · </span>':''}</div>${events.slice(0,4).map(a=>`<span class="cal-event" title="${esc(a.patient_name)} · ${timeLabel(a.starts_at)}">${timeLabel(a.starts_at)} ${esc(a.patient_name)}</span>`).join('')}</div>`;
    }).join('')}</div>`;
  }
  async function loadPatientsForForm() {
    if(!state.patients.length){state.patients=await api('/patients');state.patientListLoaded=true;}
  }
  function appointmentFormView() {
    if(!state.patients.length&&!state.patientListLoaded){loadPatientsForForm().then(()=>{if(state.page==='appointmentForm')render();}).catch(error=>toast(error.message,true));}
    const patientOptions=state.patients.map(p=>({value:p.id,label:`${p.name} · ${p.id}`}));
    const editing=state.editAppointment;
    const next=new Date(Date.now()+60*60*1000);next.setMinutes(Math.ceil(next.getMinutes()/15)*15,0,0);
    return `${heading(editing?'Reschedule appointment':'Schedule appointment',editing?'Update the visit time and details.':'Choose a patient and a future time.',buttonAction('Back to appointments','appointments','btn-outline'))}
      <form id="appointment-form" class="card form-grid">${field('Patient','patient_id',{required:true,options:patientOptions,value:editing?.patient_id||state.selectedPatient,readonly:!!editing,full:true})}${editing?`<input type="hidden" name="patient_id" value="${esc(editing.patient_id)}">`:''}
      ${field('Date & time','starts_at',{type:'datetime-local',required:true,min:localDateTime(new Date()),value:editing?localDateTime(new Date(editing.starts_at)):localDateTime(next)})}
      ${field('Duration','duration',{type:'number',required:true,min:10,max:240,step:5,value:editing?.duration||'30'})}
      ${field('Visit type','mode',{required:true,value:editing?.mode,options:[{value:'In-Person',label:'In-person'},{value:'Online',label:'Online consultation'}]})}
      ${field('Reason for consultation','reason',{required:true,value:editing?.reason||state.appointmentPrefillReason||'',full:true})}${field('Appointment notes','notes',{type:'textarea',value:editing?.notes||'',full:true})}
      ${state.appointmentPrefill?`<div class="notice span-2">Follow-up visit for ${esc(state.appointmentPrefill)}. Enter the date and visit details.</div>`:''}
      <div class="span-2 notice">Scheduling checks overlapping visits and configured unavailable dates and hours. Without availability hours, only conflicts are checked.</div>
      <div class="span-2 form-actions"><button class="btn btn-outline" type="button" data-action="appointments">Cancel</button><button class="btn btn-primary" type="submit">${editing?'Save reschedule':'Save appointment'}</button></div></form>`;
  }

  function consultationsView() {
    if(!state.consultationListLoaded){state.consultationListLoaded=true;api('/consultations').then(rows=>{state.consultations=rows;if(state.page==='consultations')render();}).catch(error=>toast(error.message,true));}
    return `${heading('Consultations','Create drafts, document visits and review clinical records.',buttonAction('New consultation','new-consultation'))}
      <section class="card list-card"><div class="card-heading"><div><h2>Consultation records</h2><p>Finalized clinical records are protected from direct edits.</p></div></div>
      ${state.consultations.length?`<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Date</th><th>Chief complaint</th><th>Diagnosis</th><th>Status</th><th></th></tr></thead><tbody>${state.consultations.map(c=>`<tr><td class="patient-cell">${esc(c.patient_name)}</td><td>${dateLabel(c.created_at)}</td><td>${esc(c.complaint||'—')}</td><td>${esc(c.diagnosis||'—')}</td><td>${badge(c.status)}</td><td>${c.status==='draft'?buttonAction('Continue draft',`edit-consultation:${c.id}`,'btn-soft btn-small'):buttonAction('Review',`review-consultation:${c.id}`,'btn-outline btn-small')}</td></tr>`).join('')}</tbody></table></div>`:empty('No consultation records','Start a consultation from an appointment or patient record.','▤')}</section>`;
  }
  function consultationFormView() {
    if(!state.patients.length&&!state.patientListLoaded){loadPatientsForForm().then(()=>{if(state.page==='consultationForm')render();}).catch(error=>toast(error.message,true));}
    const p=state.consultationDraft||{};
    const amendment=p.status==='finalized';
    const patientOptions=state.patients.map(patient=>({value:patient.id,label:`${patient.name} · ${patient.id}`}));
    if(state.selectedPatient) p.patient_id=state.selectedPatient;
    const appointmentOptions=[{value:'',label:'No linked appointment'},...((state.patientData?.appointments||[]).filter(a=>!['Cancelled','No-Show'].includes(a.status)).map(a=>({value:a.id,label:`${dateTimeLabel(a.starts_at)} · ${a.status}`})))];
    return `${heading('Consultation workspace','Enter the clinician’s own findings and decisions.',buttonAction('Cancel','cancel-consultation','btn-outline'))}
      <form class="card form-grid" id="consultation-form">${field('Patient','patient_id',{required:true,options:patientOptions,value:p.patient_id,readonly:!!state.selectedPatient})}${state.selectedPatient?`<input type="hidden" name="patient_id" value="${esc(state.selectedPatient)}">`:''}
      ${field('Link appointment','appointment_id',{options:appointmentOptions,value:p.appointment_id})}
      ${field('Chief complaint','complaint',{type:'textarea',required:true,value:p.complaint})}${field('Symptoms & duration','symptoms',{type:'textarea',value:p.symptoms})}
      ${field('Relevant medical history','history',{type:'textarea',value:p.history})}${field('Clinical findings','findings',{type:'textarea',value:p.findings})}
      ${field('Diagnosis','diagnosis',{type:'textarea',value:p.diagnosis})}${field('Treatment plan','plan',{type:'textarea',value:p.plan})}
      ${field('Doctor’s notes','notes',{type:'textarea',value:p.notes})}${field('Follow-up recommendation','follow_up',{type:'textarea',value:p.follow_up})}
      ${amendment?field('Reason for amendment','amendment_reason',{required:true,full:true}):'<div class="span-2 notice">Save as a draft, or finalize to lock this record. Later corrections are appended as amendments with a reason. Clinical judgments must be entered and approved by you.</div>'}
      <div class="span-2 form-actions"><button class="btn btn-outline" type="button" data-action="cancel-consultation">Cancel</button>${amendment?'<button class="btn btn-primary" type="submit" name="save_mode" value="amendment">Append amendment</button>':'<button class="btn btn-soft" type="submit" name="save_mode" value="draft">Save draft</button><button class="btn btn-primary" type="submit" name="save_mode" value="finalized">Finalize consultation</button>'}</div></form>`;
  }
  function consultationReviewView() {
    const c=state.consultationDetail?.consultation;
    if(!c)return spinner('Loading consultation record…');
    const fields=['complaint','symptoms','history','findings','diagnosis','plan','notes','follow_up'];
    const labels={complaint:'Chief complaint',symptoms:'Symptoms',history:'Relevant medical history',findings:'Clinical findings',diagnosis:'Diagnosis',plan:'Treatment plan',notes:'Doctor’s notes',follow_up:'Follow-up recommendations'};
    return `${heading('Finalized consultation',`${dateLabel(c.created_at)} · ${c.status}`,`${buttonAction('Append amendment','amend-consultation','btn-primary')}${buttonAction('Back to consultations','consultations','btn-outline')}`)}
      <section class="card"><div class="detail-grid"><div class="detail-item"><span>Patient ID</span><strong>${esc(c.patient_id)}</strong></div><div class="detail-item"><span>Appointment</span><strong>${esc(c.appointment_id||'Not linked')}</strong></div></div>
      ${fields.map(key=>`<div class="detail-block"><h3>${esc(labels[key])}</h3><div class="med-history">${esc(c[key]||'Not recorded')}</div></div>`).join('')}
      <div class="detail-block"><h3>Amendment history</h3>${state.consultationDetail.amendments.length?state.consultationDetail.amendments.map(item=>`<article class="record-row"><div class="record-row-head"><strong>${esc(item.reason)}</strong><span>${dateTimeLabel(item.created_at)}</span></div><pre class="med-history">${esc(JSON.stringify(JSON.parse(item.changes),null,2))}</pre></article>`).join(''):empty('No amendments','Corrections, if needed, are appended here.','◇')}</div></section>`;
  }
  function prescriptionsView() {
    if(!state.prescriptionListLoaded){state.prescriptionListLoaded=true;api('/prescriptions').then(rows=>{state.prescriptions=rows;if(state.page==='prescriptions')render();}).catch(error=>toast(error.message,true));}
    return `${heading('Prescriptions','Prepare, review, finalize and export doctor-approved prescriptions.',buttonAction('Create prescription','new-prescription'))}
      <section class="card list-card"><div class="card-heading"><div><h2>Prescription history</h2><p>Finalized prescriptions are read-only. Corrections use a new version.</p></div></div>
      ${state.prescriptions.length?`<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Date</th><th>Diagnosis</th><th>Medications</th><th>Version</th><th>Status</th><th></th></tr></thead><tbody>${state.prescriptions.map(p=>`<tr><td class="patient-cell">${esc(p.patient_name)}</td><td>${dateLabel(p.created_at)}</td><td>${esc(p.diagnosis||'—')}</td><td>${JSON.parse(p.medications).map(m=>esc(m.name)).join(', ')}</td><td>${p.version}</td><td>${badge(p.status)}</td><td><div class="table-actions">${buttonAction('PDF',`download-prescription:${p.id}`,'btn-outline btn-small')}${p.status==='finalized'?buttonAction('New version',`version-prescription:${p.id}`,'btn-soft btn-small'):buttonAction('Continue draft',`edit-prescription:${p.id}`,'btn-soft btn-small')}</div></td></tr>`).join('')}</tbody></table></div>`:empty('No prescriptions yet','A doctor can create a prescription from a patient record.','℞')}</section>`;
  }
  function medicineRow(m={},index=0) {
    return `<div class="medicine-row" data-med-row="${index}">
      ${field('Medicine name','medicine_name',{markRequired:true,value:m.name||''})}${field('Strength','medicine_strength',{markRequired:true,value:m.strength||''})}
      ${field('Dosage','medicine_dosage',{markRequired:true,value:m.dosage||''})}${field('Route','medicine_route',{markRequired:true,value:m.route||''})}
      ${field('Frequency','medicine_frequency',{markRequired:true,value:m.frequency||''})}${field('Duration','medicine_duration',{markRequired:true,value:m.duration||''})}
      ${field('Quantity','medicine_quantity',{markRequired:true,value:m.quantity||''})}${field('Instructions','medicine_instructions',{markRequired:true,value:m.instructions||''})}
      ${field('Precautions','medicine_precautions',{markRequired:true,value:m.precautions||'',full:true})}
      <div class="span-2"><button type="button" class="btn btn-danger btn-small" data-action="remove-medicine" data-row="${index}">Remove medication</button></div>
    </div>`;
  }
  function prescriptionFormView() {
    if(!state.patients.length&&!state.patientListLoaded){loadPatientsForForm().then(()=>{if(state.page==='prescriptionForm')render();}).catch(error=>toast(error.message,true));}
    const draft=state.prescriptionDraft||{};
    const patients=state.patients;
    const patientId=state.selectedPatient||draft.patient_id;
    const patient=state.patientData?.patient?.id===patientId?state.patientData.patient:
      state.prescriptionPatient?.id===patientId?state.prescriptionPatient:null;
    if(patientId&&!patient&&state.prescriptionContextId!==patientId){
      state.prescriptionContextId=patientId;
      api(`/patients/${encodeURIComponent(patientId)}`).then(data=>{
        state.prescriptionPatient=data.patient;state.prescriptionContextId=null;
        if(state.page==='prescriptionForm')render();
      }).catch(error=>toast(error.message,true));
    }
    const medications=draft.medications||[{}];
    return `${heading(draft.versionOf?'Create prescription version':'New prescription','Enter medication instructions as directed by the treating doctor.',buttonAction('Cancel','cancel-prescription','btn-outline'))}
      ${patient?`<div class="notice warning"><strong>Known allergies:</strong> ${esc(patient.allergies)} <span class="muted">· Current medications: ${esc(patient.medications)}</span></div>`:`<div class="notice" id="rx-allergy-summary">${patientId?'Loading patient allergy and medication information…':'Select a patient to review recorded allergies and medications.'}</div>`}
      <form class="card form-grid" id="prescription-form">${field('Patient','patient_id',{required:true,options:patients.map(p=>({value:p.id,label:`${p.name} · ${p.id}`})),value:state.selectedPatient||draft.patient_id,readonly:!!state.selectedPatient||!!draft.versionOf})}${state.selectedPatient||draft.versionOf?`<input type="hidden" name="patient_id" value="${esc(state.selectedPatient||draft.patient_id)}">`:''}
      ${field('Related consultation ID','consultation_id',{value:draft.consultation_id||''})}
      ${field('Diagnosis','diagnosis',{type:'textarea',value:draft.diagnosis||''})}${field('Follow-up date','follow_up',{type:'date',value:draft.follow_up||''})}
      ${field('Prescription instructions','instructions',{type:'textarea',value:draft.instructions||'',full:true})}
      ${section('Medication list')}${medications.map((m,i)=>medicineRow(m,i)).join('')}
      <div class="span-2">${btn('Add medication','add-medicine','btn-outline')}</div>
      <div class="span-2 notice">All medication details marked * must be completed before finalization. No medication or dosage is automatically recommended; enter “None” where a precaution or instruction does not apply.</div>
      <div class="span-2 form-actions"><button class="btn btn-outline" type="button" data-action="cancel-prescription">Cancel</button><button class="btn btn-soft" type="submit" name="save_mode" value="draft">Save draft</button><button class="btn btn-primary" type="submit" name="save_mode" value="finalized">Finalize prescription</button></div></form>`;
  }
  function recordsView() {
    if(!state.patientListLoaded){state.patientListLoaded=true;api('/patients').then(rows=>{state.patients=rows;if(state.page==='records')render();}).catch(error=>toast(error.message,true));return spinner();}
    return `${heading('Medical records','Search and open your doctor-owned patient histories.') }
      <section class="card list-card"><div class="card-heading"><div><h2>Patient medical records</h2><p>Clinical information is scoped to your account.</p></div></div>
      <div class="toolbar"><input type="search" id="record-search" placeholder="Filter by name or patient ID" aria-label="Filter medical records"></div>
      <div class="table-wrap"><table><thead><tr><th>Patient</th><th>Patient ID</th><th>Phone</th><th>Allergies</th><th>Medications</th><th></th></tr></thead><tbody>${state.patients.map(p=>`<tr data-record-row><td class="patient-cell">${esc(p.name)}</td><td>${esc(p.id)}</td><td>${esc(p.phone)}</td><td>${esc(state.patientData?.patient?.id===p.id?state.patientData.patient.allergies:'Open record to view')}</td><td>${esc(state.patientData?.patient?.id===p.id?state.patientData.patient.medications:'Open record to view')}</td><td>${buttonAction('Open',`open-patient:${p.id}`,'btn-soft btn-small')}</td></tr>`).join('')}</tbody></table></div>
      ${!state.patients.length?empty('No patient records','Your saved medical records will appear here.','▧'):''}</section>`;
  }
  function mentalView() {
    if(!isPsychiatrist())return `${heading('Mental Health Workspace','Confidential records for appropriately verified psychiatrists.')}${empty('Access restricted','This workspace is only available to a verified psychiatrist.','◌')}`;
    if(!state.mentalRecordsLoaded){state.mentalRecordsLoaded=true;api('/mental-records').then(rows=>{state.mentalRecords=rows;if(state.page==='mental')render();}).catch(error=>toast(error.message,true));return spinner('Loading confidential workspace…');}
    return `${heading('Mental Health Workspace','Confidential notes and assessments are restricted to your verified psychiatrist account.',buttonAction('New confidential record','new-mental'))}
      <div class="notice warning">Do not include psychiatric details in general appointment notes or notification previews. No assessments, diagnoses or treatment decisions are generated automatically.</div>
      <section class="card list-card"><div class="card-heading"><div><h2>Mental-health records</h2><p>Access is audited and restricted by the server.</p></div></div>
      ${state.mentalRecords.length?state.mentalRecords.map(r=>`<article class="record-row"><div class="record-row-head"><strong>${esc(r.patient_name)}</strong><span>${dateLabel(r.updated_at)}</span></div><p>Presenting concerns: ${esc(r.presenting||'Not recorded')} · Assessment: ${esc(r.assessment||'Not recorded')}</p><p>Progress: ${esc(r.progress||'Not recorded')} · Risk / escalation notes: ${esc(r.risk||'Not recorded')}</p><p>Referrals: ${esc(r.referrals||'Not recorded')}</p>${buttonAction('Edit confidential record',`edit-mental:${r.id}`,'btn-outline btn-small')}</article>`).join(''):empty('No mental-health records','Create a confidential record for an existing patient.','◌')}</section>`;
  }
  function notificationsView() {
    if(!state.notificationsLoaded){state.notificationsLoaded=true;api('/notifications').then(rows=>{state.notifications=rows;if(state.page==='notifications')render();}).catch(error=>toast(error.message,true));return spinner();}
    return `${heading('Notifications','Private reminders for your clinical workspace.')}${state.notifications?.length?state.notifications.map(n=>`<article class="card record-row"><div class="record-row-head"><strong>${esc(n.title)}</strong><span class="small muted">${dateTimeLabel(n.created_at)}</span></div><p>${esc(n.body)}</p>${n.read?'<span class="small muted">Read</span>':buttonAction('Mark as read',`read-notification:${n.id}`,'btn-soft btn-small')}</article>`).join(''):empty('No notifications','You will see appointment and account updates here.','♧')}`;
  }
  function profileView() {
    if(!state.profileLoaded){state.profileLoaded=true;api('/profile').then(value=>{state.profile=value;if(state.page==='profile')render();}).catch(error=>toast(error.message,true));return spinner();}
    const p=state.profile.doctor;
    const slots=state.profile.availability||[];
    const blocked=state.profile.blocked_dates||[];
    return `${heading('My Profile','Manage professional details and appointment availability.')}
      <section class="card"><div class="card-heading"><div><h2>Professional details</h2><p>Registration number and specialization are locked for verification integrity.</p></div>${badge(p.verification)}</div>
      <form id="profile-form" class="form-grid">
      ${field('Full name','name',{required:true,value:p.name})}${field('Email address','email',{type:'email',value:p.email,readonly:true})}
      ${field('Phone number','phone',{type:'tel',required:true,value:p.phone})}${field('Specialization','specialization',{value:p.specialization,readonly:true})}
      ${field('Registration number','license',{value:p.license,readonly:true})}${field('Years of experience','experience',{type:'number',value:p.experience,readonly:true})}
      ${field('Clinic name','clinic',{required:true,value:p.clinic})}${field('Clinic address','clinic_address',{required:true,value:p.clinic_address,full:true})}
      ${field('Consultation timings','timings',{required:true,value:p.timings})}${field('Clinic time zone','timezone',{required:true,value:p.timezone,help:'IANA identifier used for calendar availability.'})}
      <div class="span-2 form-actions"><button class="btn btn-primary" type="submit">Save profile</button></div></form>
      ${JSON.parse(p.additional_specializations||'[]').length?`<div class="detail-block"><h3>Additional specializations</h3><p class="muted">${JSON.parse(p.additional_specializations).map(esc).join(' · ')}</p><p class="small muted">Changes to professional credentials require review by the credential verifier.</p></div>`:''}
      <div class="detail-block"><h3>Change password</h3><form id="password-form" class="form-grid">
      ${field('Current password','current_password',{type:'password',required:true})}${field('New password','new_password',{type:'password',required:true,help:'Use at least 12 characters.'})}
      <div class="span-2 form-actions"><button class="btn btn-outline" type="submit">Update password</button></div></form></div>
      <div class="detail-block"><h3>Weekly availability</h3><p class="muted small">No weekly windows means no hours restriction, but appointment conflicts are still prevented. Times use your local clinic schedule.</p>
       ${slots.length?slots.map(s=>`<div class="record-row"><strong>${weekdays[s.weekday]}</strong><p>${esc(s.start_time)}–${esc(s.end_time)} · capacity ${s.capacity}</p><button class="btn btn-danger btn-small" data-action="remove-slot" data-id="${esc(s.id)}">Remove</button></div>`).join(''):empty('No weekly hours configured','Add at least one consultation window below.','◷')}
       <form id="availability-form" class="form-grid">
        ${field('Weekday','weekday',{required:true,options:weekdays.map((d,i)=>({value:i,label:d}))})}${field('Start time','start_time',{type:'time',required:true})}
        ${field('End time','end_time',{type:'time',required:true})}${field('Daily appointment capacity','capacity',{type:'number',required:true,min:1,max:30,value:16})}
        <div class="span-2 form-actions"><button class="btn btn-outline" type="submit">Add availability</button></div></form>
       <form id="blocked-form" class="toolbar">${field('Unavailable date','blocked_date',{type:'date',required:true})}<button class="btn btn-outline" type="submit">Block date</button></form>
       ${blocked.length?`<p class="small muted">Unavailable: ${blocked.map(d=>`${esc(dateLabel(d))} ${buttonAction('×',`unblock-date:${d}`,'btn-danger btn-small')}`).join(' · ')}</p>`:''}
      </div></section>`;
  }
  function settingsView() {
    if(!state.settings){api('/settings').then(value=>{state.settings=value;if(state.page==='settings')render();}).catch(error=>toast(error.message,true));return spinner();}
    return `${heading('Settings','Choose which private in-app updates to receive.')}
      <section class="card"><div class="card-heading"><div><h2>In-app notifications</h2><p>Notifications never include diagnoses, psychiatry notes or detailed medication information.</p></div></div>
      <form id="settings-form"><label class="checkbox-row"><input type="checkbox" name="in_app_notifications" ${state.settings.in_app_notifications?'checked':''}> Enable private appointment and account notifications</label>
      <div class="notice">Email and SMS delivery are not configured. This setting only affects the notification center in this workspace.</div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save preferences</button></div></form></section>`;
  }

  function navigate(page) {
    const fromPatient=state.page==='patient';
    if(page==='new-patient'){state.editPatient=null;state.page='newpatient';}
    else if(page==='new-appointment'){state.page='appointmentForm';state.appointmentPrefill=null;state.appointmentPrefillReason=null;state.editAppointment=null;if(!fromPatient)state.selectedPatient=null;}
    else if(page==='new-consultation'){state.consultationDraft=null;state.selectedPatient=state.page==='patient'?state.selectedPatient:null;state.page='consultationForm';}
    else if(page==='new-prescription'){state.prescriptionDraft=null;state.selectedPatient=state.page==='patient'?state.selectedPatient:null;state.page='prescriptionForm';}
    else {state.page=page;}
    if(page==='patients')state.patientListLoaded=false;
    if(page==='appointments')state.appointmentListLoaded=false;
    if(page==='consultations')state.consultationListLoaded=false;
    if(page==='prescriptions')state.prescriptionListLoaded=false;
    if(page==='records')state.patientListLoaded=false;
    if(page==='mental')state.mentalRecordsLoaded=false;
    render();
  }
  function gotoPatient(patientId) {
    state.selectedPatient=patientId;state.patientData=null;state.editPatient=null;state.page='patient';render();
  }
  function openPatientEdit() {
    if(!state.patientData)return;
    state.editPatient={...state.patientData.patient};state.page='newpatient';render();
  }
  async function submitPatient(form) {
    const values=formData(form);
    if(!values.age&&!values.dob){setFieldError(form,'dob','Enter a date of birth or age.');setFieldError(form,'age','Enter an age or date of birth.');return;}
    if(values.age&&(!/^\d{1,3}$/.test(values.age)||Number(values.age)>130)){setFieldError(form,'age','Enter an age from 0 to 130.');return;}
    if(!/^\+?[0-9 ()-]{8,18}$/.test(values.phone)||values.phone.replace(/\D/g,'').length<8){setFieldError(form,'phone','Enter a valid patient phone number.');return;}
    if(!/^\+?[0-9 ()-]{8,18}$/.test(values.emergency_phone)||values.emergency_phone.replace(/\D/g,'').length<8){setFieldError(form,'emergency_phone','Enter a valid emergency-contact phone number.');return;}
    if(values.country.trim().toLowerCase()==='india'?!/^[1-9]\d{5}$/.test(values.pin):!/^[A-Za-z0-9][A-Za-z0-9 -]{2,11}$/.test(values.pin)){setFieldError(form,'pin','Enter a valid PIN/postal code for the selected country.');return;}
    await api(state.editPatient?`/patients/${encodeURIComponent(state.editPatient.id)}`:'/patients',{method:state.editPatient?'PUT':'POST',body:JSON.stringify(values)});
    state.patientListLoaded=false;state.patientData=null;state.page='patients';toast(state.editPatient?'Patient record updated.':'Patient record saved.');render();
  }
  async function submitAppointment(form) {
    const editing=Boolean(state.editAppointment);
    const values=formData(form);values.duration=Number(values.duration);values.starts_at=new Date(values.starts_at).toISOString();
    if(editing)await api(`/appointments/${encodeURIComponent(state.editAppointment.id)}`,{method:'PATCH',body:JSON.stringify(values)});
    else await api('/appointments',{method:'POST',body:JSON.stringify(values)});
    state.editAppointment=null;state.appointmentListLoaded=false;state.dashboard=null;state.page='appointments';toast(editing?'Appointment rescheduled.':'Appointment scheduled.');render();
  }
  async function submitConsultation(form,mode) {
    const values=formData(form),finalize=mode==='finalized',amending=state.consultationDraft?.status==='finalized';
    if(state.consultationDraft?.id){
      await api(`/consultations/${encodeURIComponent(state.consultationDraft.id)}`,{method:'PATCH',body:JSON.stringify({...values,finalize})});
    }else{
      const created=await api('/consultations',{method:'POST',body:JSON.stringify(values)});
      if(finalize)await api(`/consultations/${encodeURIComponent(created.id)}`,{method:'PATCH',body:JSON.stringify({...values,finalize:true})});
    }
    if(amending){
      state.consultationDetail=await api(`/consultations/${encodeURIComponent(state.consultationDraft.id)}`);
      state.page='consultationReview';toast('Amendment appended to the consultation record.');
    }else{
      state.consultationListLoaded=false;state.patientData=null;state.page=state.selectedPatient?'patient':'consultations';toast(finalize?'Consultation finalized.':'Consultation draft saved.');
    }
    render();
  }
  function readMedicationRows(form) {
    return [...form.querySelectorAll('[data-med-row]')].map(row=>({
      name:row.querySelector('[name=medicine_name]').value,strength:row.querySelector('[name=medicine_strength]').value,
      dosage:row.querySelector('[name=medicine_dosage]').value,route:row.querySelector('[name=medicine_route]').value,
      frequency:row.querySelector('[name=medicine_frequency]').value,duration:row.querySelector('[name=medicine_duration]').value,
      quantity:row.querySelector('[name=medicine_quantity]').value,instructions:row.querySelector('[name=medicine_instructions]').value,
      precautions:row.querySelector('[name=medicine_precautions]').value
    }));
  }
  async function submitPrescription(form,mode) {
    const values=formData(form);values.medications=readMedicationRows(form);
    const finalize=mode==='finalized';
    if(!values.medications.length){toast('Add at least one medication row.',true);return;}
    if(finalize){
      let firstInvalid=null;
      for(const [index,medication] of values.medications.entries()){
        const row=form.querySelector(`[data-med-row="${index}"]`);
        for(const [key,name] of [['name','medicine_name'],['strength','medicine_strength'],['dosage','medicine_dosage'],['route','medicine_route'],['frequency','medicine_frequency'],['duration','medicine_duration'],['quantity','medicine_quantity'],['instructions','medicine_instructions'],['precautions','medicine_precautions']]){
          if(!medication[key].trim()){
            const fieldElement=row?.querySelector(`[name="${name}"]`)?.closest('.field');
            if(fieldElement){fieldElement.classList.add('invalid');fieldElement.querySelector('.field-error').textContent='Complete this field before finalizing.';firstInvalid??=fieldElement.querySelector('input,textarea');}
          }
        }
      }
      if(firstInvalid){firstInvalid.focus();return;}
    }
    if(state.prescriptionDraft?.id){
      await api(`/prescriptions/${encodeURIComponent(state.prescriptionDraft.id)}`,{method:'PATCH',body:JSON.stringify({...values,finalize})});
    }else if(state.prescriptionDraft?.versionOf){
      const created=await api(`/prescriptions/${encodeURIComponent(state.prescriptionDraft.versionOf)}/version`,{method:'POST',body:JSON.stringify(values)});
      if(finalize)await api(`/prescriptions/${encodeURIComponent(created.id)}`,{method:'PATCH',body:JSON.stringify({...values,finalize:true})});
    }else{
      const created=await api('/prescriptions',{method:'POST',body:JSON.stringify(values)});
      if(finalize)await api(`/prescriptions/${encodeURIComponent(created.id)}`,{method:'PATCH',body:JSON.stringify({...values,finalize:true})});
    }
    state.prescriptionListLoaded=false;state.page='prescriptions';toast(finalize?'Prescription finalized.':'Prescription draft saved.');render();
  }
  async function downloadPdf(prescriptionId) {
    const response=await api(`/prescriptions/${encodeURIComponent(prescriptionId)}/pdf`);
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`prescription-${prescriptionId.slice(0,8)}.pdf`;link.click();URL.revokeObjectURL(url);
  }
  async function updateAppointment(id,status) {
    await api(`/appointments/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status})});
    state.appointmentListLoaded=false;state.dashboard=null;toast(`Appointment marked ${status.toLowerCase()}.`);render();
  }

  app.addEventListener('submit',async event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    event.preventDefault();
    const submitter=event.submitter,mode=submitter?.value||'draft';
    try{
      if(form.id==='login-form'){
        const values=formData(form);values.remember=form.elements.remember.checked;
        const session=await api('/login',{method:'POST',body:JSON.stringify(values)});
        state.csrf=session.csrf;
        const me=await api('/me');state.doctor=me.doctor;state.csrf=me.csrf;state.page='dashboard';render();
      }else if(form.id==='register-form'){
        const values=formData(form);
        if(values.additional_specializations)values.additional_specializations=values.additional_specializations.split(',').map(value=>value.trim()).filter(Boolean);
        const result=await api('/register',{method:'POST',body:JSON.stringify(values)});
        document.querySelector('#auth-message').innerHTML=`<div class="notice">${esc(result.message)}</div>`;
        toast('Registration received.');authView(false);
      }else if(form.id==='patient-search'){
        state.patientQuery=form.elements.q.value.trim();state.patientListLoaded=false;render();
      }else if(form.id==='patient-form')await submitPatient(form);
      else if(form.id==='appointment-form')await submitAppointment(form);
      else if(form.id==='consultation-form')await submitConsultation(form,mode);
      else if(form.id==='prescription-form')await submitPrescription(form,mode);
      else if(form.id==='profile-form'){
        await api('/profile',{method:'PUT',body:JSON.stringify(formData(form))});state.profileLoaded=false;toast('Profile updated.');render();
      }else if(form.id==='settings-form'){
        const value={in_app_notifications:form.elements.in_app_notifications.checked};
        await api('/settings',{method:'PUT',body:JSON.stringify(value)});state.settings=value;toast('Notification preferences updated.');render();
      }else if(form.id==='password-form'){
        await api('/password',{method:'PUT',body:JSON.stringify(formData(form))});state.doctor=null;state.csrf='';toast('Password updated. Sign in with your new password.');authView(false);
      }else if(form.id==='availability-form'){
        const value=formData(form),slots=[...(state.profile.availability||[]),{weekday:Number(value.weekday),start_time:value.start_time,end_time:value.end_time,capacity:Number(value.capacity)}];
        await api('/availability',{method:'PUT',body:JSON.stringify({slots,blocked_dates:state.profile.blocked_dates||[]})});state.profileLoaded=false;toast('Availability updated.');render();
      }else if(form.id==='blocked-form'){
        const value=form.elements.blocked_date.value,blocked=[...new Set([...(state.profile.blocked_dates||[]),value])];
        await api('/availability',{method:'PUT',body:JSON.stringify({slots:state.profile.availability||[],blocked_dates:blocked})});state.profileLoaded=false;toast('Unavailable date saved.');render();
      }else if(form.id==='mental-form'){
        const value=formData(form),isEdit=Boolean(state.mentalDraft?.id);
        await api(isEdit?`/mental-records/${encodeURIComponent(state.mentalDraft.id)}`:'/mental-records',{method:isEdit?'PUT':'POST',body:JSON.stringify(value)});
        state.mentalDraft=null;
        state.mentalRecordsLoaded=false;state.page='mental';toast('Confidential record saved.');render();
      }else if(form.id==='forgot-form'){
        const value=formData(form),result=await api('/forgot-password',{method:'POST',body:JSON.stringify(value)});
        toast(result.message);authView(false);
      }
    }catch(error){toast(error.message,true);}
  });

  app.addEventListener('click',async event=>{
    const pageButton=event.target.closest('[data-page]');
    if(pageButton){navigate(pageButton.dataset.page);closeMobileMenu();return;}
    const tab=event.target.closest('[data-patient-tab]');
    if(tab){document.querySelectorAll('[data-patient-tab]').forEach(el=>el.classList.toggle('active',el===tab));document.querySelector('#patient-record-tab').innerHTML=patientHistoryTab(tab.dataset.patientTab);return;}
    const actionElement=event.target.closest('[data-action]');
    if(!actionElement)return;
    const action=actionElement.dataset.action;
    try{
      if(action==='show-register'){authView(true);return;}
      if(action==='show-login'){authView(false);return;}
      if(action==='toggle-password'){
        const input=document.getElementById(actionElement.dataset.for),show=input?.type==='password';
        if(input)input.type=show?'text':'password';
        actionElement.textContent=show?'Hide':'Show';
        actionElement.setAttribute('aria-label',`${show?'Hide':'Show'} ${input?.labels?.[0]?.textContent?.replace('*','')||'password'}`);
        actionElement.setAttribute('aria-pressed',String(show));
        return;
      }
      if(action==='retry-current'){
        if(state.page==='dashboard')state.dashboard=null;
        if(state.page==='patients')state.patientListLoaded=false;
        if(state.page==='appointments')state.appointmentListLoaded=false;
        if(state.page==='consultations')state.consultationListLoaded=false;
        if(state.page==='prescriptions')state.prescriptionListLoaded=false;
        if(state.page==='records')state.patientListLoaded=false;
        if(state.page==='patient')state.patientData=null;
        if(state.page==='mental')state.mentalRecordsLoaded=false;
        if(state.page==='notifications')state.notificationsLoaded=false;
        if(state.page==='profile')state.profileLoaded=false;
        if(state.page==='settings')state.settings=null;
        render();return;
      }
      if(action==='forgot'){
        app.querySelector('.auth-box').innerHTML=`<div class="eyebrow">ACCOUNT RECOVERY</div><h2>Reset your password</h2><p class="intro">Self-service recovery is not configured. Contact the clinic administrator through the verified identity process.</p><form id="forgot-form">${field('Registered email address','email',{type:'email',required:true})}<div class="form-actions"><button class="btn btn-primary" type="submit">Request guidance</button></div></form><p class="auth-switch"><button class="text-button" data-action="show-login">Back to sign in</button></p>`;
        return;
      }
      if(action==='logout'){
        await api('/logout',{method:'POST',body:'{}'});state.doctor=null;state.csrf='';state.dashboard=null;state.patientData=null;toast('Signed out.');authView(false);return;
      }
      if(action==='new-patient'){navigate('new-patient');return;}
      if(action==='new-appointment'){navigate('new-appointment');return;}
      if(action==='schedule-follow-up'){
        navigate('new-appointment');state.appointmentPrefill=state.patientData?.patient?.name||'patient';
        state.appointmentPrefillReason='Follow-up';render();return;
      }
      if(action.startsWith('reschedule:')){
        const appointment=state.appointments.find(item=>item.id===action.slice('reschedule:'.length));
        if(!appointment)return;
        state.editAppointment={...appointment};state.selectedPatient=null;state.page='appointmentForm';render();return;
      }
      if(action==='new-consultation'){navigate('new-consultation');return;}
      if(action==='new-prescription'){navigate('new-prescription');return;}
      if(action==='patients'||action==='appointments'||action==='consultations'||action==='prescriptions'){navigate(action);return;}
      if(action==='edit-patient'){openPatientEdit();return;}
      if(action==='open-patient'){
        const patientId=actionElement.dataset.id||action.split(':')[1];gotoPatient(patientId);return;
      }
      if(action.startsWith('appointment-consultation:')){
        const [,patientId,appointmentId]=action.split(':');
        state.selectedPatient=patientId;state.patientData=null;
        state.page='patient';await api(`/patients/${encodeURIComponent(patientId)}`).then(data=>{state.patientData=data;});
        state.consultationDraft={patient_id:patientId,appointment_id:appointmentId};state.page='consultationForm';render();return;
      }
      if(action.startsWith('edit-consultation:')){
        const consultation=state.consultations.find(item=>item.id===action.slice('edit-consultation:'.length));
        if(!consultation)return;
        state.selectedPatient=consultation.patient_id;
        state.consultationDraft={...consultation};state.page='consultationForm';
        if(!state.patients.length)await loadPatientsForForm();
        render();return;
      }
      if(action.startsWith('review-consultation:')){
        const consultationId=action.slice('review-consultation:'.length);
        state.consultationDetail=await api(`/consultations/${encodeURIComponent(consultationId)}`);
        state.page='consultationReview';render();return;
      }
      if(action==='amend-consultation'){
        if(!state.consultationDetail)return;
        state.consultationDraft={...state.consultationDetail.consultation};
        state.page='consultationForm';render();return;
      }
      if(action==='cancel-consultation'){const wasFinalized=state.consultationDraft?.status==='finalized';state.consultationDraft=null;state.patientData=null;state.page=wasFinalized?'consultationReview':state.selectedPatient?'patient':'consultations';render();return;}
      if(action==='cancel-prescription'){state.prescriptionDraft=null;state.page=state.selectedPatient?'patient':'prescriptions';render();return;}
      if(action==='add-medicine'){const form=document.querySelector('#prescription-form'),rows=readMedicationRows(form);rows.push({});state.prescriptionDraft={...state.prescriptionDraft,medications:rows};render();return;}
      if(action==='remove-medicine'){const form=document.querySelector('#prescription-form'),rows=readMedicationRows(form);rows.splice(Number(actionElement.dataset.row),1);if(!rows.length)rows.push({});state.prescriptionDraft={...state.prescriptionDraft,medications:rows};render();return;}
      if(action==='calendar-prev'||action==='calendar-next'){
          const amount=action==='calendar-prev'?-1:1;
          if(state.calendarMode==='week')state.calendarDate.setDate(state.calendarDate.getDate()+amount*7);
          else if(state.calendarMode==='day')state.calendarDate.setDate(state.calendarDate.getDate()+amount);
          else state.calendarDate.setMonth(state.calendarDate.getMonth()+amount);
        render();return;
      }
      if(action==='calendar-today'){state.calendarDate=new Date();render();return;}
      if(action==='open-menu'){document.querySelector('#sidebar').classList.add('open');document.querySelector('.mobile-backdrop').classList.add('show');return;}
      if(action==='close-menu'){closeMobileMenu();return;}
      if(action==='download-prescription'){await downloadPdf(action.split(':')[1]);return;}
      if(action.startsWith('download-prescription:')){await downloadPdf(action.split(':')[1]);return;}
      if(action.startsWith('finalize-prescription:')){
        const p=state.prescriptions.find(item=>item.id===action.split(':')[1]);if(!p)return;
        await api(`/prescriptions/${encodeURIComponent(p.id)}`,{method:'PATCH',body:JSON.stringify({diagnosis:p.diagnosis,instructions:p.instructions,follow_up:p.follow_up,medications:JSON.parse(p.medications),finalize:true})});
        state.prescriptionListLoaded=false;toast('Prescription finalized.');render();return;
      }
      if(action.startsWith('version-prescription:')){
        const p=state.prescriptions.find(item=>item.id===action.split(':')[1]);if(!p)return;
        state.selectedPatient=p.patient_id;state.prescriptionDraft={...p,medications:JSON.parse(p.medications),versionOf:p.id};state.page='prescriptionForm';render();return;
      }
      if(action.startsWith('edit-prescription:')){
        const prescription=state.prescriptions.find(item=>item.id===action.slice('edit-prescription:'.length));
        if(!prescription)return;
        state.selectedPatient=prescription.patient_id;state.prescriptionDraft={...prescription,medications:JSON.parse(prescription.medications)};state.page='prescriptionForm';render();return;
      }
      if(action.startsWith('read-notification:')){
        await api(`/notifications/${encodeURIComponent(action.split(':')[1])}`,{method:'PATCH',body:'{}'});state.notificationsLoaded=false;render();return;
      }
      if(action==='remove-slot'){
        const slots=(state.profile.availability||[]).filter(slot=>slot.id!==actionElement.dataset.id);
        await api('/availability',{method:'PUT',body:JSON.stringify({slots,blocked_dates:state.profile.blocked_dates||[]})});state.profileLoaded=false;toast('Availability removed.');render();return;
      }
      if(action.startsWith('unblock-date:')){
        const date=action.slice('unblock-date:'.length),blocked=(state.profile.blocked_dates||[]).filter(item=>item!==date);
        await api('/availability',{method:'PUT',body:JSON.stringify({slots:state.profile.availability||[],blocked_dates:blocked})});state.profileLoaded=false;toast('Date availability restored.');render();return;
      }
      if(action==='new-mental'){state.mentalDraft=null;state.page='mentalForm';renderMentalForm();return;}
      if(action.startsWith('edit-mental:')){
        const record=state.mentalRecords.find(item=>item.id===action.slice('edit-mental:'.length));
        if(!record)return;
        state.mentalDraft={...record};state.page='mentalForm';renderMentalForm();return;
      }
      if(action==='cancel-mental'){state.page='mental';render();return;}
    }catch(error){toast(error.message,true);}
  });
  function closeMobileMenu(){document.querySelector('#sidebar')?.classList.remove('open');document.querySelector('.mobile-backdrop')?.classList.remove('show');}
  function renderMentalForm() {
    if(!state.patients.length&&!state.patientListLoaded)loadPatientsForForm().then(()=>{if(state.page==='mentalForm')renderMentalForm();}).catch(error=>toast(error.message,true));
    const patients=state.patients.map(p=>({value:p.id,label:`${p.name} · ${p.id}`}));
    const draft=state.mentalDraft||{};
    const form=`${heading('Confidential mental-health record','For use by the verified treating psychiatrist.',buttonAction('Cancel','cancel-mental','btn-outline'))}
      <form id="mental-form" class="card form-grid">${field('Patient','patient_id',{required:true,options:patients,value:draft.patient_id,readonly:!!draft.id,full:true})}${draft.id?`<input type="hidden" name="patient_id" value="${esc(draft.patient_id)}">`:''}
      ${field('Presenting concerns','presenting',{type:'textarea',value:draft.presenting,full:true})}${field('Symptoms and duration','symptoms',{type:'textarea',value:draft.symptoms})}
      ${field('Relevant mental-health history','history',{type:'textarea',value:draft.history})}${field('Previous treatments','treatments',{type:'textarea',value:draft.treatments})}
      ${field('Relevant family history','family_history',{type:'textarea',value:draft.family_history})}${field('Clinical observations','observations',{type:'textarea',value:draft.observations})}
      ${field('Assessment findings','assessment',{type:'textarea',value:draft.assessment})}${field('Treatment goals','goals',{type:'textarea',value:draft.goals})}
      ${field('Treatment plan','plan',{type:'textarea',value:draft.plan})}${field('Follow-up notes','follow_up',{type:'textarea',value:draft.follow_up})}
      ${field('Progress tracking','progress',{type:'textarea',value:draft.progress})}${field('Referral notes','referrals',{type:'textarea',value:draft.referrals})}
      ${field('Risk and escalation documentation','risk',{type:'textarea',value:draft.risk,full:true})}
      <div class="span-2 notice warning">Confidential. This record is server-restricted to verified psychiatrists and access is audited. Record your own clinical assessment; this app does not generate diagnoses or treatment decisions.</div>
      <div class="span-2 form-actions"><button class="btn btn-outline" type="button" data-action="cancel-mental">Cancel</button><button class="btn btn-primary" type="submit">${draft.id?'Update confidential record':'Save confidential record'}</button></div></form>`;
    shell(form);
  }

  app.addEventListener('change',async event=>{
    const target=event.target;
    if(target.name==='patient_id'&&target.closest('#prescription-form')){
      const patientId=target.value,summary=document.querySelector('#rx-allergy-summary');
      state.selectedPatient=null;state.prescriptionPatient=null;state.prescriptionContextId=patientId;
      if(summary)summary.textContent=patientId?'Loading patient allergy and medication information…':'Select a patient to review recorded allergies and medications.';
      if(patientId)try{
        const data=await api(`/patients/${encodeURIComponent(patientId)}`);
        state.prescriptionPatient=data.patient;state.prescriptionContextId=null;
        const targetSummary=document.querySelector('#rx-allergy-summary');
        if(targetSummary)targetSummary.innerHTML=`<strong>Known allergies:</strong> ${esc(data.patient.allergies)} <span class="muted">· Current medications: ${esc(data.patient.medications)}</span>`;
      }catch(error){toast(error.message,true);}
    }
    if(target.id==='appointment-filter'){state.appointmentStatus=target.value;state.appointmentListLoaded=false;render();}
    if(target.id==='calendar-mode'){state.calendarMode=target.value;render();}
    if(target.matches('[data-appointment-status]')&&target.value){
      try{await updateAppointment(target.dataset.appointmentStatus,target.value);}
      catch(error){toast(error.message,true);state.appointmentListLoaded=false;render();}
    }
  });
  app.addEventListener('input',event=>{
    const field=event.target.closest('.field');
    if(field){const error=field.querySelector('.field-error');if(error?.textContent)setFieldError(event.target.form, event.target.name, '');}
    if(event.target.id==='record-search'){
      const query=event.target.value.toLowerCase();
      document.querySelectorAll('[data-record-row]').forEach(row=>row.classList.toggle('hidden',!row.textContent.toLowerCase().includes(query)));
    }
    if(event.target.id==='appointment-search'){
      const query=event.target.value.toLowerCase();
      document.querySelectorAll('[data-appointment-row]').forEach(row=>row.classList.toggle('hidden',!row.textContent.toLowerCase().includes(query)));
    }
  });
  async function start() {
    try{
      const me=await api('/me');state.doctor=me.doctor;state.csrf=me.csrf;
      if(state.doctor.verification==='verified')loadDashboard();
      render();
    }catch(error){authView(false);}
  }
  start();
})();
