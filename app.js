// --- State Management ---
let supabaseClient = null;
let tasks = [];
let currentFilter = 'all';
let realtimeSubscription = null;
let config = { url: '', key: '' };

// --- Window Onload ---
window.onload = function() {
    initDateDisplay();
    loadStoredConfig();
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

function loadStoredConfig() {
    const storedUrl = localStorage.getItem('supabase_url');
    const storedKey = localStorage.getItem('supabase_key');
    if (storedUrl && storedKey) {
        config.url = storedUrl;
        config.key = storedKey;
        const urlInput = document.getElementById('cfg-supabase-url');
        const keyInput = document.getElementById('cfg-supabase-key');
        if (urlInput) urlInput.value = storedUrl;
        if (keyInput) keyInput.value = storedKey;
    }
}

// --- Supabase Initialization ---
function initSupabase() {
    if (!config.url || !config.key) {
        updateConnectionStatus(false, 'ไม่ได้ระบุ Key');
        loadFallbackLocalTasks();
        return;
    }

    try {
        supabaseClient = window.supabase.createClient(config.url, config.key);
        updateConnectionStatus(true, 'Supabase Connected');
        fetchTasksFromSupabase();
        subscribeRealtime();
    } catch (err) {
        console.error("Supabase Init Error:", err);
        updateConnectionStatus(false, 'เชื่อมต่อไม่สำเร็จ');
        loadFallbackLocalTasks();
    }
}

function updateConnectionStatus(isConnected, message) {
    const dot = document.getElementById('db-status-dot');
    const text = document.getElementById('db-status-text');

    if (dot && text) {
        if (isConnected) {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse inline-block';
            text.textContent = message;
            text.className = 'text-emerald-400 text-xs font-medium';
        } else {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 inline-block';
            text.textContent = message;
            text.className = 'text-slate-400 text-xs';
        }
    }
}

// --- Fetch & Realtime ---
async function fetchTasksFromSupabase() {
    if (!supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('todos')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching tasks:", error);
        showToast('ไม่สามารถดึงข้อมูลจาก Supabase ได้', 'error');
        loadFallbackLocalTasks();
        return;
    }

    tasks = data || [];
    renderTasks();
    updateAnalytics();
}

function subscribeRealtime() {
    if (!supabaseClient) return;

    if (realtimeSubscription) {
        supabaseClient.removeChannel(realtimeSubscription);
    }

    realtimeSubscription = supabaseClient
        .channel('public:todos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, payload => {
            fetchTasksFromSupabase();
            showToast('ซิงค์ข้อมูลเรียลไทม์สำเร็จ ⚡', 'success');
        })
        .subscribe();
}

// --- Local Fallback ---
function loadFallbackLocalTasks() {
    const local = localStorage.getItem('local_fallback_tasks');
    if (local) {
        tasks = JSON.parse(local);
    } else {
        tasks = [
            { id: '1', title: 'ตัวอย่างงาน: เตรียมสไลด์นำเสนอโปรเจกต์', priority: 'high', category: 'Work', due_date: '2026-10-31', due_time: '14:00', completed: false, source: 'manual', created_at: new Date().toISOString() },
            { id: '2', title: 'ตัวอย่างงาน: ออกกำลังกายตอนเย็น', priority: 'low', category: 'Personal', due_date: null, due_time: '18:30', completed: true, source: 'telegram', created_at: new Date().toISOString() }
        ];
    }
    renderTasks();
    updateAnalytics();
}

function saveLocalFallbackTasks() {
    localStorage.setItem('local_fallback_tasks', JSON.stringify(tasks));
}

// --- Task CRUD Operations ---
async function handleAddTask(e) {
    e.preventDefault();
    const titleInput = document.getElementById('task-title');
    const priorityInput = document.getElementById('task-priority');
    const categoryInput = document.getElementById('task-category');
    const dueDateInput = document.getElementById('task-due-date');
    const dueTimeInput = document.getElementById('task-due-time');

    const title = titleInput ? titleInput.value.trim() : '';
    const priority = priorityInput ? priorityInput.value : 'medium';
    const category = categoryInput ? (categoryInput.value.trim() || 'Work') : 'Work';
    const due_date = dueDateInput ? dueDateInput.value : null;
    const due_time = dueTimeInput ? dueTimeInput.value : null;

    if (!title) return;

    const newTask = {
        title,
        priority,
        category,
        due_date: due_date || null,
        due_time: due_time || null,
        completed: false,
        source: 'manual'
    };

    if (supabaseClient) {
        const { error } = await supabaseClient.from('todos').insert([newTask]);
        if (error) {
            showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
        } else {
            showToast('เพิ่มงานสำเร็จ!', 'success');
            if (titleInput) titleInput.value = '';
            if (dueDateInput) dueDateInput.value = '';
            if (dueTimeInput) dueTimeInput.value = '';
            fetchTasksFromSupabase();
        }
    } else {
        newTask.id = Date.now().toString();
        newTask.created_at = new Date().toISOString();
        tasks.unshift(newTask);
        saveLocalFallbackTasks();
        renderTasks();
        updateAnalytics();
        showToast('เพิ่มงานลง Local สำเร็จ!', 'success');
        if (titleInput) titleInput.value = '';
    }
}

async function toggleTaskComplete(id) {
    const task = tasks.find(t => t.id == id);
    if (!task) return;
    const newStatus = !task.completed;

    if (supabaseClient) {
        const { error } = await supabaseClient.from('todos').update({ completed: newStatus }).eq('id', id);
        if (error) {
            showToast('ไม่สามารถอัปเดตสถานะได้', 'error');
        } else {
            fetchTasksFromSupabase();
        }
    } else {
        task.completed = newStatus;
        saveLocalFallbackTasks();
        renderTasks();
        updateAnalytics();
    }
}

async function deleteTask(id) {
    if (!confirm('คุณต้องการลบงานนี้ใช่หรือไม่?')) return;

    if (supabaseClient) {
        const { error } = await supabaseClient.from('todos').delete().eq('id', id);
        if (error) {
            showToast('ไม่สามารถลบข้อมูลได้', 'error');
        } else {
            showToast('ลบงานเรียบร้อย', 'success');
            fetchTasksFromSupabase();
        }
    } else {
        tasks = tasks.filter(t => t.id != id);
        saveLocalFallbackTasks();
        renderTasks();
        updateAnalytics();
        showToast('ลบงานเรียบร้อย', 'success');
    }
}

function openEditModal(id) {
    const task = tasks.find(t => t.id == id);
    if (!task) return;
    document.getElementById('edit-task-id').value = task.id;
    document.getElementById('edit-task-title').value = task.title;
    document.getElementById('edit-task-priority').value = task.priority;
    document.getElementById('edit-task-due-date').value = task.due_date || '';
    document.getElementById('edit-task-due-time').value = task.due_time || '';
    toggleModal('edit-task-modal');
}

async function saveEditTask() {
    const id = document.getElementById('edit-task-id').value;
    const title = document.getElementById('edit-task-title').value.trim();
    const priority = document.getElementById('edit-task-priority').value;
    const due_date = document.getElementById('edit-task-due-date').value;
    const due_time = document.getElementById('edit-task-due-time').value;

    if (!title) return;

    if (supabaseClient) {
        const { error } = await supabaseClient.from('todos').update({ title, priority, due_date: due_date || null, due_time: due_time || null }).eq('id', id);
        if (error) {
            showToast('แก้ไขข้อมูลไม่สำเร็จ', 'error');
        } else {
            showToast('บันทึกการแก้ไขเรียบร้อย', 'success');
            toggleModal('edit-task-modal');
            fetchTasksFromSupabase();
        }
    } else {
        const task = tasks.find(t => t.id == id);
        if (task) {
            task.title = title;
            task.priority = priority;
            task.due_date = due_date || null;
            task.due_time = due_time || null;
            saveLocalFallbackTasks();
            renderTasks();
            updateAnalytics();
            showToast('บันทึกการแก้ไขเรียบร้อย', 'success');
            toggleModal('edit-task-modal');
        }
    }
}

// --- Filter & Sorting ---
function setFilter(filterType) {
    currentFilter = filterType;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.className = 'filter-btn px-3 py-1.5 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition';
    });
    const activeBtn = document.getElementById(`filter-${filterType}`);
    if (activeBtn) {
        activeBtn.className = 'filter-btn px-3 py-1.5 rounded-xl text-xs font-medium transition bg-rose-600 text-white';
    }
    renderTasks();
}

function renderTasks() {
    const container = document.getElementById('tasks-container');
    const sortSelect = document.getElementById('sort-select');
    const sortVal = sortSelect ? sortSelect.value : 'latest';

    let filtered = tasks.filter(t => {
        if (currentFilter === 'pending') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
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
        container.innerHTML = `
            <div class="glass-panel p-8 rounded-2xl text-center space-y-2">
                <i class="fa-solid fa-clipboard-list text-3xl text-slate-600"></i>
                <p class="text-xs text-slate-400">ไม่พบรายการงานในตัวกรองนี้</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const priorityBadge = t.priority === 'high' 
            ? '<span class="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-md">High</span>'
            : t.priority === 'medium'
            ? '<span class="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md">Medium</span>'
            : '<span class="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-md">Low</span>';

        const sourceBadge = t.source === 'telegram'
            ? '<span class="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded flex items-center gap-1"><i class="fa-brands fa-telegram"></i> Telegram</span>'
            : '<span class="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Manual</span>';

        return `
            <div class="glass-panel p-4 rounded-2xl flex items-center justify-between gap-3 transition hover:border-slate-700 ${t.completed ? 'opacity-60' : ''}">
                <div class="flex items-center gap-3.5 flex-1 min-w-0">
                    <input type="checkbox" ${t.completed ? 'checked' : ''} onchange="toggleTaskComplete('${t.id}')"
                           class="w-4 h-4 rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-rose-500 cursor-pointer accent-rose-500">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="text-xs font-semibold text-slate-200 truncate ${t.completed ? 'line-through text-slate-500' : ''}">${escapeHtml(t.title)}</h4>
                            ${priorityBadge}
                            ${sourceBadge}
                        </div>
                        <div class="flex items-center gap-3 text-[11px] text-slate-400 mt-1 flex-wrap">
                            <span class="bg-slate-900 px-2 py-0.5 rounded border border-slate-800">${escapeHtml(t.category || 'Work')}</span>
                            ${t.due_date ? `<span class="flex items-center gap-1 text-rose-400"><i class="fa-regular fa-calendar"></i> ${t.due_date}</span>` : ''}
                            ${t.due_time ? `<span class="flex items-center gap-1 text-amber-400"><i class="fa-regular fa-clock"></i> ${t.due_time}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick="openEditModal('${t.id}')" class="p-2 text-slate-400 hover:text-slate-200 transition" title="แก้ไข">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button onclick="deleteTask('${t.id}')" class="p-2 text-slate-400 hover:text-rose-400 transition" title="ลบ">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// --- Analytics ---
function updateAnalytics() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const high = tasks.filter(t => t.priority === 'high').length;
    const medium = tasks.filter(t => t.priority === 'medium').length;
    const low = tasks.filter(t => t.priority === 'low').length;

    const statTotal = document.getElementById('stat-total');
    const statCompleted = document.getElementById('stat-completed');
    if (statTotal) statTotal.textContent = total;
    if (statCompleted) statCompleted.textContent = completed;

    const highCount = document.getElementById('stat-high-count');
    const medCount = document.getElementById('stat-medium-count');
    const lowCount = document.getElementById('stat-low-count');
    if (highCount) highCount.textContent = high;
    if (medCount) medCount.textContent = medium;
    if (lowCount) lowCount.textContent = low;

    const highBar = document.getElementById('stat-high-bar');
    const medBar = document.getElementById('stat-medium-bar');
    const lowBar = document.getElementById('stat-low-bar');
    if (highBar) highBar.style.width = total ? `${(high / total) * 100}%` : '0%';
    if (medBar) medBar.style.width = total ? `${(medium / total) * 100}%` : '0%';
    if (lowBar) lowBar.style.width = total ? `${(low / total) * 100}%` : '0%';

    const pct = total ? Math.round((completed / total) * 100) : 0;
    const headerBar = document.getElementById('header-progress-bar');
    const headerText = document.getElementById('header-progress-text');
    if (headerBar) headerBar.style.width = `${pct}%`;
    if (headerText) headerText.textContent = `${pct}%`;
}

// --- Telegram Simulation ---
function fillSim(text) {
    const simInput = document.getElementById('sim-input-text');
    if (simInput) simInput.value = text;
}

async function handleSimulateTelegram(e) {
    e.preventDefault();
    const simInput = document.getElementById('sim-input-text');
    const text = simInput ? simInput.value.trim() : '';
    if (!text) return;

    let priority = 'medium';
    if (text.includes('#high')) priority = 'high';
    if (text.includes('#low')) priority = 'low';

    let category = 'Work';
    if (text.includes('#Personal')) category = 'Personal';

    const timeMatch = text.match(/@(\d{2}:\d{2})/);
    const due_time = timeMatch ? timeMatch[1] : null;

    const dateMatch = text.match(/@(\d{4}-\d{2}-\d{2})/);
    const due_date = dateMatch ? dateMatch[1] : null;

    let cleanTitle = text.replace('/add', '').replace(/#\w+/g, '').replace(/@\d{2}:\d{2}/g, '').replace(/@\d{4}-\d{2}-\d{2}/g, '').trim();

    const newTelegramTask = {
        title: cleanTitle || 'งานจาก Telegram Bot',
        priority,
        category,
        due_date,
        due_time,
        completed: false,
        source: 'telegram'
    };

    if (supabaseClient) {
        const { error } = await supabaseClient.from('todos').insert([newTelegramTask]);
        if (error) {
            showToast('ซิงค์ Telegram เข้า Supabase ไม่สำเร็จ', 'error');
        } else {
            showToast('จำลองข้อความจาก Telegram สำเร็จ! 📲', 'success');
            if (simInput) simInput.value = '';
            fetchTasksFromSupabase();
        }
    } else {
        newTelegramTask.id = Date.now().toString();
        newTelegramTask.created_at = new Date().toISOString();
        tasks.unshift(newTelegramTask);
        saveLocalFallbackTasks();
        renderTasks();
        updateAnalytics();
        showToast('จำลองข้อความ Telegram ลง Local สำเร็จ', 'success');
        if (simInput) simInput.value = '';
    }
}

// --- Config & Settings ---
function saveSupabaseConfig() {
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-key').value.trim();
    if (!url || !key) {
        showToast('กรุณากรอก URL และ Anon Key ให้ครบถ้วน', 'error');
        return;
    }
    localStorage.setItem('supabase_url', url);
    localStorage.setItem('supabase_key', key);
    config.url = url;
    config.key = key;
    toggleModal('settings-modal');
    initSupabase();
    showToast('บันทึกการตั้งค่า Supabase เรียบร้อย', 'success');
}

async function testSupabaseConnection() {
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-key').value.trim();
    if (!url || !key) {
        showToast('กรุณากรอกข้อมูลก่อนทดสอบ', 'error');
        return;
    }
    try {
        const tempClient = window.supabase.createClient(url, key);
        const { error } = await tempClient.from('todos').select('id').limit(1);
        if (error) throw error;
        showToast('เชื่อมต่อ Supabase สำเร็จ! 🟢', 'success');
    } catch (err) {
        showToast('เชื่อมต่อไม่สำเร็จ (ตรวจสอบ URL/Key หรือตาราง todos)', 'error');
    }
}

// --- Helpers & UI ---
function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.toggle('hidden');
    }
}

function copySqlScript() {
    const codeEl = document.getElementById('sql-script-code');
    if (codeEl) {
        navigator.clipboard.writeText(codeEl.innerText);
        showToast('คัดลอก SQL Script เรียบร้อย', 'success');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `p-3 rounded-xl text-xs font-medium text-white shadow-lg pointer-events-auto transition transform translate-y-2 opacity-0 flex items-center gap-2 ${
        type === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
    }`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${escapeHtml(message)}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
