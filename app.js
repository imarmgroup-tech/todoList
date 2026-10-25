// --- State Management ---
let supabaseClient = null;
let tasks = [];
let currentFilter = 'all';
let realtimeSubscription = null;

// ตั้งค่า Supabase URL และ Anon Key แบบถาวร
let config = {
    url: 'https://ccdvahuhcfpfxtulqbmc.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjZHZhaHVoY2ZwZnh0dWxxYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MzQ5NDIsImV4cCI6MjEwODUxMDk0Mn0.MCqJ4iDt9Y0A0V42nloYlIuV3QSSjmEBgauZ4Tn-oqc
' // ใส่ Anon Key ตัวเต็มของคุณที่นี่
};

// --- Window Onload ---
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

// --- Supabase Initialization ---
function initSupabase() {
    if (!config.url || !config.key) {
        updateConnectionStatus(false, 'ไม่ได้ระบุ Key');
        return;
    }

    try {
        supabaseClient = window.supabase.createClient(config.url, config.key);
        updateConnectionStatus(true, '🟢 Supabase Connected');
        
        fetchTasksFromSupabase();
        subscribeRealtime();
    } catch (err) {
        console.error("Supabase Init Error:", err);
        updateConnectionStatus(false, 'เชื่อมต่อไม่สำเร็จ');
    }
}

function updateConnectionStatus(isConnected, message) {
    const dot = document.getElementById('db-status-dot');
    const text = document.getElementById('db-status-text');

    if (dot && text) {
        if (isConnected) {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
            text.textContent = message;
            text.className = 'text-emerald-400 font-medium';
        } else {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
            text.textContent = message;
            text.className = 'text-slate-400';
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
        return;
    }

    tasks = data || [];
    renderTasks();
}

function subscribeRealtime() {
    if (!supabaseClient) return;

    if (realtimeSubscription) {
        supabaseClient.removeChannel(realtimeSubscription);
    }

    realtimeSubscription = supabaseClient
        .channel('public:todos')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, payload => {
            console.log('Realtime Event Received:', payload);
            
            if (payload.eventType === 'INSERT') {
                tasks.unshift(payload.new);
                showToast(`⚡ มีงานใหม่เพิ่มเข้ามา: "${payload.new.title}"`, 'info');
            } else if (payload.eventType === 'UPDATE') {
                const index = tasks.findIndex(t => t.id === payload.new.id);
                if (index !== -1) tasks[index] = payload.new;
            } else if (payload.eventType === 'DELETE') {
                tasks = tasks.filter(t => t.id !== payload.old.id);
            }

            renderTasks();
        })
        .subscribe();
}

// --- Render UI ---
function renderTasks() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    if (tasks.length === 0) {
        container.innerHTML = `<p class="text-center text-slate-500 py-4">ไม่พบรายการงาน</p>`;
        return;
    }

    container.innerHTML = tasks.map(t => `
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center">
            <span>${escapeHtml(t.title)}</span>
            <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">${t.source || 'manual'}</span>
        </div>
    `).join('');
}

// --- Helpers ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `bg-slate-900 border px-4 py-2 rounded-xl text-xs shadow-xl ${type === 'error' ? 'border-rose-500 text-rose-200' : 'border-emerald-500 text-emerald-200'}`;
    toast.innerHTML = escapeHtml(message);

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
