// --- State Management ---
let supabaseClient = null;
let currentUser = null;
let authMode = 'login';
let tasks = [];
let currentFilter = 'all';
let realtimeSubscription = null;
let currentCalendarDate = new Date();
let selectedCalendarDateStr = '';

const ADMIN_EMAIL = 'imarm.group@gmail.com'; 

window.onload = function() {
    initDateDisplay();
    initSupabase();
};

function initDateDisplay() {
    const dateEl = document.getElementById('current-date-str');
    if (dateEl) {
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('th-TH', { 
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
        });
    }
}

function initSupabase() {
    try {
        if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') {
            showToast('ไม่พบไฟล์ config.js หรือค่ากำหนด Supabase', 'error');
            return;
        }

        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        supabaseClient.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                currentUser = session.user;
                showAppUI();
            } else {
                showAuthUI();
            }
        });

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (session) {
                currentUser = session.user;
                showAppUI();
            } else {
                currentUser = null;
                showAuthUI();
            }
        });

    } catch (err) {
        console.error("Supabase Init Error:", err);
        showToast('ไม่สามารถเชื่อมต่อฐานข้อมูลได้', 'error');
    }
}

// --- Auth Operations ---
function setAuthMode(mode) { authMode = mode; }

async function handleAuth(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    if (!email || !password) return;

    if (authMode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) showToast('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
        else showToast('เข้าสู่ระบบสำเร็จ! 👋', 'success');
    } else {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) showToast(error.message, 'error');
        else showToast('สมัครสมาชิกสำเร็จ!', 'success');
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    showToast('ออกจากระบบเรียบร้อย', 'success');
}

function showAuthUI() {
    document.getElementById('auth-container')?.classList.remove('hidden');
    document.getElementById('app-container')?.classList.add('hidden');
}

function showAppUI() {
    document.getElementById('auth-container')?.classList.add('hidden');
    document.getElementById('app-container')?.classList.remove('hidden');
    
    const userEmailEl = document.getElementById('user-email-display');
    if (userEmailEl && currentUser) {
        const isAdmin = currentUser.email === ADMIN_EMAIL;
        userEmailEl.innerHTML = `${currentUser.email} ${isAdmin ? '<span class="bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded text-[10px] ml-1">Admin</span>' : ''}`;
    }
    
    setFilter('all');
    fetchTasksFromSupabase();
    subscribeRealtime();
}

// --- Task CRUD Operations ---
async function fetchTasksFromSupabase() {
    if (!supabaseClient || !currentUser) return;

    // RLS จะทำหน้าที่กรองให้อัตโนมัติ: (งานตัวเอง OR งานที่เป็น Public OR Admin ดึงหมด)
    const { data, error } = await supabaseClient
        .from('todos')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch Error:", error);
        showToast('ไม่สามารถดึงข้อมูลงานได้', 'error');
        return;
    }

    tasks = data || [];
    checkDailyRoutineReset();
    renderTasks();
    renderCalendar();
    updateAnalytics();
}

function subscribeRealtime() {
    if (!supabaseClient || !currentUser) return;

    if (realtimeSubscription) supabaseClient.removeChannel(realtimeSubscription);

    realtimeSubscription = supabaseClient
        .channel('public:todos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {
            fetchTasksFromSupabase();
        })
        .subscribe();
}

function checkDailyRoutineReset() {
    const todayStr = new Date().toISOString().split('T')[0];
    tasks.forEach(async (t) => {
        if (t.is_routine && t.completed && t.last_completed_date !== todayStr) {
            await supabaseClient.from('todos').update({ completed: false }).eq('id', t.id);
        }
    });
}

async function handleAddTask(e) {
    e.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    const priority = document.getElementById('task-priority').value;
    const category = document.getElementById('task-category').value.trim() || 'Work';
    const due_date = document.getElementById('task-due-date').value || null;
    const due_time = document.getElementById('task-due-time').value || null;
    const is_routine = document.getElementById('task-is-routine').checked;
    const is_public = document.getElementById('task-is-public')?.checked || false;

    if (!title || !currentUser) return;

    const newTask = { 
        user_id: currentUser.id,
        title, 
        priority, 
        category, 
        due_date, 
        due_time, 
        is_routine, 
        is_public,
        completed: false, 
        source: 'manual' 
    };

    const { error } = await supabaseClient.from('todos').insert([newTask]);
    if (error) {
        console.error("Insert Error:", error);
        showToast('เกิดข้อผิดพลาดในการเพิ่มงาน', 'error');
    } else {
        showToast('เพิ่มงานสำเร็จ!', 'success');
        document.getElementById('task-title').value = '';
        document.getElementById('task-due-date').value = '';
        document.getElementById('task-due-time').value = '';
        document.getElementById('task-is-routine').checked = false;
        if(document.getElementById('task-is-public')) document.getElementById('task-is-public').checked = false;
        fetchTasksFromSupabase();
    }
}

async function toggleTaskComplete(id) {
    const task = tasks.find(t => t.id == id);
    if (!task) return;
    
    // ห้ามแก้ของคนอื่น ถ้าไม่ใช่เจ้าของหรือ Admin
    if (task.user_id !== currentUser.id && currentUser.email !== ADMIN_EMAIL) {
        showToast('คุณไม่มีสิทธิ์แก้ไขงานของสมาชิกท่านอื่น', 'error');
        return;
    }

    const newStatus = !task.completed;
    const todayStr = new Date().toISOString().split('T')[0];
    
    const { error } = await supabaseClient
        .from('todos')
        .update({ completed: newStatus, last_completed_date: newStatus ? todayStr : null })
        .eq('id', id);

    if (error) showToast('ไม่สามารถอัปเดตสถานะได้', 'error');
    else fetchTasksFromSupabase();
}

async function deleteTask(id) {
    const task = tasks.find(t => t.id == id);
    if (!task) return;

    if (task.user_id !== currentUser.id && currentUser.email !== ADMIN_EMAIL) {
        showToast('คุณไม่มีสิทธิ์ลบงานของสมาชิกท่านอื่น', 'error');
        return;
    }

    if (!confirm('คุณต้องการลบงานนี้ใช่หรือไม่?')) return;
    const { error } = await supabaseClient.from('todos').delete().eq('id', id);
    if (error) showToast('ไม่สามารถลบข้อมูลได้', 'error');
    else { 
        showToast('ลบงานเรียบร้อย', 'success'); 
        fetchTasksFromSupabase(); 
    }
}

// --- Calendar View & Public Badge ---
function switchView(viewType) {
    const taskContainer = document.getElementById('tasks-container');
    const calendarContainer = document.getElementById('calendar-container');
    const btnList = document.getElementById('view-btn-list');
    const btnCal = document.getElementById('view-btn-calendar');

    if (viewType === 'list') {
        taskContainer.classList.remove('hidden');
        calendarContainer.classList.add('hidden');
        btnList.className = 'bg-rose-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer';
        btnCal.className = 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer';
    } else {
        taskContainer.classList.add('hidden');
        calendarContainer.classList.remove('hidden');
        btnCal.className = 'bg-rose-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer';
        btnList.className = 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer';
        renderCalendar();
    }
}

function changeMonth(direction) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + direction);
    renderCalendar();
}

function renderCalendar() {
    const gridEl = document.getElementById('calendar-grid');
    const monthYearEl = document.getElementById('calendar-month-year');
    if (!gridEl || !monthYearEl) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    monthYearEl.textContent = `${monthNames[month]} ${year + 543}`;

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    let html = '';
    for (let i = 0; i < firstDayIndex; i++) {
        html += `<div class="h-24 bg-slate-900/20 rounded-xl border border-slate-800/40 opacity-30"></div>`;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let day = 1; day <= totalDays; day++) {
        const formattedDay = String(day).padStart(2, '0');
        const formattedMonth = String(month + 1).padStart(2, '0');
        const dateStr = `${year}-${formattedMonth}-${formattedDay}`;

        const dayTasks = tasks.filter(t => t.due_date === dateStr);
        const isToday = dateStr === todayStr;

        html += `
            <div onclick="openDateModal('${dateStr}')" class="h-28 bg-slate-900/60 border ${isToday ? 'border-rose-500 shadow-lg shadow-rose-500/10' : 'border-slate-800'} rounded-xl p-1.5 flex flex-col justify-between transition hover:border-slate-600 cursor-pointer overflow-hidden">
                <div class="flex justify-between items-center text-[11px]">
                    <span class="font-bold ${isToday ? 'bg-rose-600 text-white px-1.5 rounded-full' : 'text-slate-300'}">${day}</span>
                    ${dayTasks.length > 0 ? `<span class="bg-rose-500/20 text-rose-400 px-1 rounded text-[9px]">${dayTasks.length} งาน</span>` : ''}
                </div>
                <div class="flex-1 overflow-y-auto space-y-1 mt-1 scrollbar-none">
                    ${dayTasks.map(t => {
                        const isOthers = t.user_id !== currentUser?.id;
                        return `
                            <div class="text-[10px] ${isOthers ? 'bg-sky-950/80 border-sky-800 text-sky-200' : 'bg-slate-800/80 border-slate-700/50 text-slate-200'} border px-1.5 py-0.5 rounded truncate ${t.completed ? 'line-through opacity-50' : ''}" title="${escapeHtml(t.title)} ${isOthers ? '(ของสมาชิกคนอื่น)' : ''}">
                                ${t.is_public ? '<i class="fa-solid fa-earth-americas text-[9px] text-sky-400 mr-0.5"></i>' : ''} ${escapeHtml(t.title)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    gridEl.innerHTML = html;
}

function openDateModal(dateStr) {
    selectedCalendarDateStr = dateStr;
    const modalTitle = document.getElementById('modal-date-title');
    const listContainer = document.getElementById('modal-day-tasks-list');
    
    if (modalTitle) {
        const [y, m, d] = dateStr.split('-');
        modalTitle.textContent = `${d}/${m}/${parseInt(y) + 543}`;
    }

    const dayTasks = tasks.filter(t => t.due_date === dateStr);

    if (listContainer) {
        if (dayTasks.length === 0) {
            listContainer.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">ไม่มีรายการงานในวันนี้</p>`;
        } else {
            listContainer.innerHTML = dayTasks.map(t => {
                const isOwner = t.user_id === currentUser?.id || currentUser?.email === ADMIN_EMAIL;
                return `
                    <div class="bg-slate-900/80 border ${t.user_id !== currentUser?.id ? 'border-sky-800/60' : 'border-slate-800'} p-3 rounded-xl flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <input type="checkbox" ${t.completed ? 'checked' : ''} ${!isOwner ? 'disabled' : ''} onchange="toggleTaskComplete('${t.id}'); openDateModal('${dateStr}');" class="w-4 h-4 rounded border-slate-700 bg-slate-900 text-rose-600 cursor-pointer accent-rose-500">
                            <div class="min-w-0">
                                <p class="text-xs font-semibold text-slate-200 truncate ${t.completed ? 'line-through text-slate-500' : ''}">
                                    ${t.is_public ? '<span class="text-[9px] bg-sky-500/20 text-sky-400 px-1 py-0.5 rounded mr-1">Public</span>' : ''}
                                    ${escapeHtml(t.title)}
                                </p>
                                <p class="text-[10px] text-slate-400">หมวดหมู่: ${escapeHtml(t.category || 'Work')} ${t.due_time ? `| เวลา: ${t.due_time}` : ''}</p>
                            </div>
                        </div>
                        ${isOwner ? `
                            <button onclick="deleteTask('${t.id}'); openDateModal('${dateStr}');" class="text-slate-500 hover:text-rose-400 p-1 cursor-pointer" title="ลบงาน">
                                <i class="fa-solid fa-trash text-xs"></i>
                            </button>
                        ` : '<span class="text-[10px] text-slate-500 italic">อ่านอย่างเดียว</span>'}
                    </div>
                `;
            }).join('');
        }
    }

    toggleModal('day-tasks-modal');
}

// --- Helpers & UI ---
function setFilter(filterType) {
    currentFilter = filterType;
    ['all', 'pending', 'completed'].forEach(type => {
        const btn = document.getElementById(`filter-${type}`);
        if (btn) {
            btn.className = type === filterType 
                ? 'filter-btn bg-rose-600 text-white px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer' 
                : 'filter-btn text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer';
        }
    });
    renderTasks();
}

function renderTasks() {
    const container = document.getElementById('tasks-container');
    const sortVal = document.getElementById('sort-select').value;

    let filtered = tasks.filter(t => {
        if (currentFilter === 'pending') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        if (currentFilter === 'routine') return t.is_routine;
        if (currentFilter === 'telegram') return t.source === 'telegram';
        return true;
    });

    filtered.sort((a, b) => {
        if (sortVal === 'priority') {
            const weight = { high: 3, medium: 2, low: 1 };
            return (weight[b.priority] || 2) - (weight[a.priority] || 2);
        } else if (sortVal === 'due_date') {
            return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31');
        } else {
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
    });

    const countAll = document.getElementById('count-all');
    const countPending = document.getElementById('count-pending');
    const countCompleted = document.getElementById('count-completed');

    if (countAll) countAll.textContent = tasks.length;
    if (countPending) countPending.textContent = tasks.filter(t => !t.completed).length;
    if (countCompleted) countCompleted.textContent = tasks.filter(t => t.completed).length;

    if (!container) return;
    if (filtered.length === 0) {
        container.innerHTML = `<div class="glass-panel p-8 rounded-2xl text-center space-y-2 border border-neutral-800"><i class="fa-solid fa-clipboard-list text-3xl text-neutral-600"></i><p class="text-xs text-neutral-400">ไม่พบรายการงานในตัวกรองนี้</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const isOwner = t.user_id === currentUser?.id || currentUser?.email === ADMIN_EMAIL;
        const isOthers = t.user_id !== currentUser?.id;

        const priorityBadge = t.priority === 'high' 
            ? '<span class="text-[10px] bg-red-950/60 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-md">High</span>' 
            : t.priority === 'medium' 
            ? '<span class="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/50 px-2 py-0.5 rounded-md">Medium</span>' 
            : '<span class="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-md">Low</span>';

        const routineBadge = t.is_routine ? '<span class="text-[10px] bg-neutral-800 text-red-400 border border-neutral-700 px-2 py-0.5 rounded flex items-center gap-1"><i class="fa-solid fa-repeat"></i> งานประจำ</span>' : '';
        const sourceBadge = t.source === 'telegram' ? '<span class="text-[10px] bg-neutral-800 text-white border border-neutral-700 px-2 py-0.5 rounded flex items-center gap-1"><i class="fa-brands fa-telegram text-red-500"></i> Telegram</span>' : '';
        const publicBadge = t.is_public ? '<span class="text-[10px] bg-neutral-800 text-white border border-neutral-700 px-2 py-0.5 rounded-md flex items-center gap-1"><i class="fa-solid fa-earth-americas text-red-500"></i> Public</span>' : '';

        return `
            <div class="glass-panel p-4 rounded-2xl flex items-center justify-between gap-3 transition hover:border-neutral-700 border border-neutral-800 ${t.completed ? 'opacity-60' : ''}">
                <div class="flex items-center gap-3.5 flex-1 min-w-0">
                    <input type="checkbox" ${t.completed ? 'checked' : ''} ${!isOwner ? 'disabled' : ''} onchange="toggleTaskComplete('${t.id}')" class="w-4 h-4 rounded border-neutral-700 bg-black text-red-600 cursor-pointer accent-red-600">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="text-xs font-semibold text-white truncate ${t.completed ? 'line-through text-neutral-500' : ''}">${escapeHtml(t.title)}</h4>
                            ${priorityBadge}
                            ${routineBadge}
                            ${sourceBadge}
                            ${publicBadge}
                            ${isOthers ? '<span class="text-[10px] bg-neutral-900 text-neutral-400 border border-neutral-800 px-2 py-0.5 rounded-md">สมาชิกคนอื่น</span>' : ''}
                        </div>
                        <div class="flex items-center gap-3 text-[11px] text-neutral-400 mt-1 flex-wrap">
                            <span class="bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">${escapeHtml(t.category || 'Work')}</span>
                            ${t.due_date ? `<span class="flex items-center gap-1 text-red-500"><i class="fa-regular fa-calendar"></i> ${t.due_date}</span>` : ''}
                            ${t.due_time ? `<span class="flex items-center gap-1 text-amber-400"><i class="fa-regular fa-clock"></i> ${t.due_time}</span>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Action Buttons (ปุ่มจอง Google Calendar, ปุ่มแก้ไข, และปุ่มลบ) -->
                <div class="flex items-center gap-1">
                    <button onclick="addToCalendar('${t.id}')" class="p-2 text-neutral-400 hover:text-white transition cursor-pointer" title="จองลงปฏิทิน (Google Calendar)">
                        <i class="fa-regular fa-calendar-plus text-xs"></i>
                    </button>
                    ${isOwner ? `
                        <button onclick="openEditModal('${t.id}')" class="p-2 text-neutral-400 hover:text-white transition cursor-pointer" title="แก้ไขงาน">
                            <i class="fa-solid fa-pen text-xs"></i>
                        </button>
                        <button onclick="deleteTask('${t.id}')" class="p-2 text-neutral-400 hover:text-red-500 transition cursor-pointer" title="ลบงาน">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    ` : '<span class="text-[10px] text-neutral-500 italic px-2">อ่านอย่างเดียว</span>'}
                </div>
            </div>
        `;
    }).join('');
}

function updateAnalytics() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-completed').textContent = completed;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    document.getElementById('header-progress-bar').style.width = `${pct}%`;
    document.getElementById('header-progress-text').textContent = `${pct}%`;
}

function toggleModal(modalId) { 
    const el = document.getElementById(modalId);
    if (el) el.classList.toggle('hidden'); 
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `p-3 rounded-xl text-xs font-medium text-white shadow-lg pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2 ${type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => { toast.classList.add('opacity-0', 'translate-y-2'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
// อัปเดตฟังก์ชันนี้ใน app.js ของคุณ
function jumpToAddFormWithDate() {
    // ปิด Modal รายการงานประจำวันก่อน
    toggleModal('day-tasks-modal');
    
    const dueDateInput = document.getElementById('task-due-date');
    if (dueDateInput && selectedCalendarDateStr) {
        dueDateInput.value = selectedCalendarDateStr;
        switchView('list'); // สลับกลับมาหน้าแสดงผลรายการปกติ
        showToast(`เลือกวันที่ ${selectedCalendarDateStr} แล้ว กรอกรายละเอียดด้านบนได้เลย`, 'success');
        document.getElementById('task-title').focus();
    }
}
