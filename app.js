var API_URL = "https://script.google.com/macros/s/AKfycbwHA9QpcBwA-4vtFANUYDkUp_rJIxw0NilgbmxqSmgrTJWasiJ5_O_aGCT20QCnki1BjA/exec";

// Global State Data
var productsData = [];
var membersData = [];
var activeTransactions = []; 

var currentUser = null;
var currentCart = []; 
var selectedCustomerType = 'REGULAR';
var selectedMemberId = null;
var currentRestoredTransId = null; 
var lastSuccessfulTransaction = null;

// Modal & Customization State
var modalTriggerSource = null; 
var activeCartIndex = null;
var activeProductId = null;
var holdCustomQty = 1;
var selectedIce = "Normal Ice";
var selectedSugar = "Normal Sugar";

var holdTimer = null;
var isLongPress = false;

document.addEventListener("DOMContentLoaded", function() {
  // 1. Load Logo Header
  var headerLogo = document.getElementById('header-brand-logo');
  if (headerLogo && typeof APP_ASSETS !== 'undefined' && APP_ASSETS.logoHeader) {
    headerLogo.src = APP_ASSETS.logoHeader;
  }

  // 2. Load Logo Login
  var loginLogo = document.getElementById('login-brand-logo');
  if (loginLogo && typeof APP_ASSETS !== 'undefined' && APP_ASSETS.logoUtama) {
    loginLogo.src = APP_ASSETS.logoUtama;
  }

  // 3. FIX: Sembunyikan Bottom Nav jika user belum login (#app-page masih tersembunyi)
  var appPage = document.getElementById('app-page');
  var bottomNav = document.querySelector('.bottom-nav-bar');
  if (appPage && appPage.classList.contains('hidden') && bottomNav) {
    bottomNav.style.display = 'none';
  }

  checkExistingSession();
  loadDataFromSheet();
  
  // Set status indikator awal saat aplikasi dimuat
  updateOnlineStatusUI();

  // Event saat koneksi internet terhubung kembali
  window.addEventListener('online', function() {
    updateOnlineStatusUI();
    showAlert('Koneksi internet kembali! Mengirim data antrean...', 'Online', 'info');
    processSyncQueue();
  });

  // Event saat koneksi internet terputus
  window.addEventListener('offline', function() {
    updateOnlineStatusUI();
    showAlert('Koneksi terputus! Menggunakan mode offline (Local Storage).', 'Offline', 'warning');
  });
});

// Helper untuk memperbarui tampilan indikator di header HTML
function updateOnlineStatusUI() {
  var dot = document.getElementById('status-dot');
  var text = document.getElementById('status-text');
  
  if (!dot || !text) return;

  if (navigator.onLine) {
    dot.style.background = '#4caf50'; // Warna Hijau
    text.innerText = 'Online';
  } else {
    dot.style.background = '#f44336'; // Warna Merah
    text.innerText = 'Offline';
  }
}

// A. SAAT CEK SESI / INIT APP
function checkExistingSession() {
  var savedSession = localStorage.getItem('qiski_session');
  var bottomNav = document.querySelector('.bottom-nav-bar');

  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    document.getElementById('user-display').innerText = currentUser.nama;
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');

    // TAMPILKAN BOTTOM NAV HANYA JIKA LOGIN & DI MOBILE
    if (bottomNav) {
      bottomNav.style.setProperty('display', (window.innerWidth <= 768 ? 'flex' : 'none'), 'important');
    }

    showDashboard();
  } else {
    // PASTIIN SEMBUNYI SAAT MASIH DI LOGIN
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app-page').classList.add('hidden');
    
    if (bottomNav) {
      bottomNav.style.setProperty('display', 'none', 'important');
    }
  }
}

function handleLogin(e) {
  e.preventDefault();
  var u = document.getElementById('username').value;
  var p = document.getElementById('password').value;

  showLoading('Memverifikasi Login...');

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'checkLogin', username: u, password: p })
  })
  .then(res => res.json())
  .then(res => {
    hideLoading();
    if (res.success) {
      currentUser = res.user;
      localStorage.setItem('qiski_session', JSON.stringify(currentUser));
      document.getElementById('user-display').innerText = currentUser.nama;
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('app-page').classList.remove('hidden');

      // PAKSA TAMPILKAN BOTTOM NAV PAS SUKSES LOGIN DI MOBILE
      var bottomNav = document.querySelector('.bottom-nav-bar');
      if (bottomNav) {
        bottomNav.style.setProperty('display', (window.innerWidth <= 768 ? 'flex' : 'none'), 'important');
      }

      showDashboard();
    } else { 
      showAlert(res.message, 'Gagal Login', 'error'); 
    }
  })
  .catch(err => {
    hideLoading();
    showAlert('Gagal terhubung ke server: ' + err.toString(), 'Error', 'error');
  });
}

function logout() { 
  localStorage.removeItem('qiski_session'); 
  
  // Sembunyikan Bottom Nav sebelum reload
  var bottomNav = document.querySelector('.bottom-nav-bar');
  if (bottomNav) bottomNav.style.display = 'none';

  location.reload(); 
}

// DATA FETCHING & SYNC ENGINE (ONLINE FIRST WITH OFFLINE FALLBACK)
function loadDataFromSheet() {
  // 1. Tampilkan loading overlay di awal refresh/load
  showLoading('Memuat data sistem...');

  // 2. Ambil data lokal terlebih dahulu agar UI tidak kosong jika offline
  var localActive = localStorage.getItem('pos_active_orders');
  if (localActive) {
    try { activeTransactions = JSON.parse(localActive); } catch(e) { activeTransactions = []; }
    updateBadges();
  }

  var localProducts = localStorage.getItem('pos_products');
  if (localProducts) {
    try { 
      productsData = JSON.parse(localProducts); 
      renderCatalog();
    } catch(e) {}
  }

  // 3. Jika online, langsung perbarui data terbaru dari Apps Script
  if (isOnline()) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getInitialData' })
    })
    .then(res => res.json())
    .then(res => {
      if (res.success && res.data) {
        productsData = res.data.products || [];
        membersData = res.data.members || [];
        
        localStorage.setItem('pos_products', JSON.stringify(productsData));
        localStorage.setItem('pos_members', JSON.stringify(membersData));

        if (res.data.activeTransactions) {
          activeTransactions = res.data.activeTransactions;
          localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
        }
        renderCatalog();
        updateBadges();
        processSyncQueue();
      }
    })
    .catch(err => {
      console.warn("Koneksi gagal saat load awal, menggunakan data lokal:", err);
    })
    .finally(() => {
      // Selesai narik data dari server -> Matikan loading
      hideLoading();
    });
  } else {
    // Jika posisi offline sejak awal, langsung matikan loading
    hideLoading();
  }
}

function isOnline() {
  return navigator.onLine;
}

function queueForSync(action, payload) {
  var queue = JSON.parse(localStorage.getItem('pos_sync_queue') || '[]');
  queue.push({
    id: 'SYNC-' + Date.now(),
    action: action,
    payload: payload,
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('pos_sync_queue', JSON.stringify(queue));
  
  if (isOnline()) {
    processSyncQueue();
  }
}

function processSyncQueue() {
  if (!isOnline()) return;

  var queue = JSON.parse(localStorage.getItem('pos_sync_queue') || '[]');
  if (queue.length === 0) return;

  var item = queue[0];

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: item.action, payload: item.payload })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      var currentQueue = JSON.parse(localStorage.getItem('pos_sync_queue') || '[]');
      currentQueue.shift();
      localStorage.setItem('pos_sync_queue', JSON.stringify(currentQueue));

      if (currentQueue.length > 0) {
        processSyncQueue();
      }
    }
  })
  .catch(err => console.warn('Sync tertunda karena gangguan koneksi:', err));
}

function updateBadges() {
  var now = new Date();
  var todayYear = now.getFullYear();
  var todayMonth = now.getMonth();
  var todayDate = now.getDate();

  var isToday = function(waktuStr) {
    if (!waktuStr) return false;
    var d = new Date(waktuStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === todayYear && 
             d.getMonth() === todayMonth && 
             d.getDate() === todayDate;
    }
    var datePart = String(waktuStr).split(' ')[0].split('T')[0];
    var todayStr = todayYear + '-' + String(todayMonth + 1).padStart(2, '0') + '-' + String(todayDate).padStart(2, '0');
    return datePart === todayStr;
  };

  // 1. Pending (Hari Ini)
  var pendingCount = activeTransactions.filter(function(t) {
    return String(t.status).toUpperCase() === 'PENDING' && isToday(t.waktu);
  }).length;

  // 2. Proses (Semua Antrian Dapur)
  var prosesCount = activeTransactions.filter(function(t) {
    return String(t.status).toUpperCase() === 'PROSES';
  }).length;

  // 3. Selesai (Hari Ini) -> Tambahan Perbaikan
  var selesaiCount = activeTransactions.filter(function(t) {
    return String(t.status).toUpperCase() === 'SELESAI' && isToday(t.waktu);
  }).length;

  // Render Badges ke HTML
  var pendingBadge = document.getElementById('badge-pending');
  var prosesBadge = document.getElementById('badge-proses');
  var selesaiBadge = document.getElementById('badge-selesai');

  if (pendingBadge) {
    pendingBadge.innerText = pendingCount;
    pendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
  if (prosesBadge) {
    prosesBadge.innerText = prosesCount;
    prosesBadge.style.display = prosesCount > 0 ? 'inline-block' : 'none';
  }
  if (selesaiBadge) {
    selesaiBadge.innerText = selesaiCount;
    selesaiBadge.style.display = selesaiCount > 0 ? 'inline-block' : 'none';
  }
}

// ROUTING & HEADER NAVIGATION
function setActiveHeaderTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (tabId) {
    var target = document.getElementById(tabId);
    if (target) target.classList.add('active');
  }
}

function hideAllViews() {
  var views = ['home-dashboard-view', 'new-order-view', 'pending-orders-view', 'kitchen-orders-view', 'completed-orders-view'];
  views.forEach(id => {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showDashboard() {
  setActiveHeaderTab('tab-home');
  hideAllViews();
  var homeView = document.getElementById('home-dashboard-view');
  if (homeView) homeView.classList.remove('hidden');
}

function openNewOrderFlow() {
  selectCustomerType('REGULAR');
  document.getElementById('cust-name').value = '';
  document.getElementById('member-search-input').value = '';
  selectedMemberId = null;

  document.getElementById('gate-loading-overlay').classList.add('hidden');
  document.getElementById('customer-gate-modal').classList.remove('hidden');
}

function confirmCustomerAndProceed() {
  var nameVal = '';

  if (selectedCustomerType === 'REGULAR') {
    nameVal = document.getElementById('cust-name').value.trim();
    if (!nameVal) {
      showAlert('Silakan masukkan nama Customer terlebih dahulu!', 'Peringatan', 'error');
      document.getElementById('cust-name').focus();
      return;
    }
  } else {
    nameVal = document.getElementById('member-search-input').value.trim();
    if (!nameVal || !selectedMemberId) {
      showAlert('Silakan pilih member terdaftar dari daftar pencarian!', 'Peringatan', 'error');
      document.getElementById('member-search-input').focus();
      return;
    }
  }

  closeModal('customer-gate-modal');
  setActiveHeaderTab(null);
  hideAllViews();
  document.getElementById('new-order-view').classList.remove('hidden');

  document.getElementById('cart-customer-name').innerText = getActiveCustomerName();
  
  var searchInp = document.getElementById('menu-search-input');
  if (searchInp) searchInp.value = '';

  clearCart();
}

// CUSTOMER & MEMBER MANAGEMENT
function selectCustomerType(type) {
  selectedCustomerType = type;
  var chipUmum = document.getElementById('chip-umum');
  var chipMember = document.getElementById('chip-member');
  var inputNama = document.getElementById('input-nama-container');
  var selectMember = document.getElementById('select-member-container');

  if (type === 'REGULAR') {
    chipUmum.classList.add('selected');
    chipMember.classList.remove('selected');
    inputNama.classList.remove('hidden');
    selectMember.classList.add('hidden');
  } else {
    chipMember.classList.add('selected');
    chipUmum.classList.remove('selected');
    inputNama.classList.add('hidden');
    selectMember.classList.remove('hidden');
  }
}

function renderMemberList(filterText) {
  var container = document.getElementById('member-items-list');
  var keyword = (filterText || "").toLowerCase();

  var filtered = membersData.filter(m => 
    (m.nama && m.nama.toLowerCase().includes(keyword)) || 
    (m.hp && String(m.hp).includes(keyword))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 10px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">Member tidak ditemukan</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => `
    <div onclick="selectMember('${m.id}', '${m.nama}', '${m.hp}')" style="padding: 10px 12px; cursor: pointer; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f9f9f9;" onmouseover="this.style.background='#fffaf5'" onmouseout="this.style.background='#fff'">
      ${m.nama} <span style="color: var(--text-muted); font-size: 11px; font-weight: 500;">(${m.hp})</span>
    </div>
  `).join('');
}

function showMemberDropdown() {
  document.getElementById('member-dropdown').classList.remove('hidden');
  renderMemberList(document.getElementById('member-search-input').value);
}

function filterMemberList() {
  var keyword = document.getElementById('member-search-input').value;
  selectedMemberId = null;
  renderMemberList(keyword);
  document.getElementById('member-dropdown').classList.remove('hidden');
}

function selectMember(id, name, phone) {
  selectedMemberId = id;
  document.getElementById('member-search-input').value = `${name} (${phone})`;
  document.getElementById('member-dropdown').classList.add('hidden');
}

function openAddMemberModal() {
  document.getElementById('member-dropdown').classList.add('hidden');
  document.getElementById('new-member-name').value = '';
  document.getElementById('new-member-phone').value = '';
  document.getElementById('new-member-dob').value = '';
  document.getElementById('add-member-modal').classList.remove('hidden');
}

function handleSaveNewMember(e) {
  e.preventDefault();
  var name = document.getElementById('new-member-name').value.trim();
  var phone = document.getElementById('new-member-phone').value.trim();

  var newId = 'MEMBER-' + Date.now();
  var newMember = { id: newId, nama: name, hp: phone, poin: 0 };
  membersData.push(newMember);
  localStorage.setItem('pos_members', JSON.stringify(membersData));

  selectMember(newId, name, phone);
  closeModal('add-member-modal');
  showAlert(`Member baru "${name}" berhasil didaftarkan!`, 'Sukses', 'success');
}

document.addEventListener('click', function(e) {
  var container = document.getElementById('select-member-container');
  if (container && !container.contains(e.target)) {
    var dropdown = document.getElementById('member-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
});

// CATALOG RENDERING
// Variable penanda touch
var isTouchAction = false;

// CATALOG RENDERING (BISA SCROLL & GAK KELIPATAN 2)
function renderCatalog(itemsToRender) {
  var container = document.getElementById('catalog-container');
  var list = itemsToRender || productsData;

  if (!list || list.length === 0) {
    container.innerHTML = '<p style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 13px; font-weight: 700;">Tidak ada menu yang ditemukan</p>';
    return;
  }

  var categories = [...new Set(list.map(p => p.kategori))];
  
  container.innerHTML = categories.map(cat => {
    var items = list.filter(p => p.kategori === cat);
    return `
      <div class="category-title">${cat}</div>
      <div class="menu-grid">
        ${items.map(p => `
          <div class="menu-card" 
               onmousedown="startHold('${p.id}', false)" 
               onmouseup="endHold('${p.id}', false)" 
               onmouseleave="cancelHold()"
               ontouchstart="startHold('${p.id}', true)" 
               ontouchend="endHold('${p.id}', true)"
               ontouchcancel="cancelHold()">
            <h4>${p.nama}</h4>
            <div class="price">Rp ${Number(p.harga).toLocaleString('id-ID')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

// HOLD & CLICK CONTROL (FIXED SCROLL + NO DOUBLE TRIGGER)
function startHold(productId, isTouch) {
  if (isTouch) {
    isTouchAction = true; // Tandai kalau ini aksi dari HP/Touch
  } else if (isTouchAction) {
    // Jika event mouse terpicu padahal tadi udah lewat touch, abaikan!
    return;
  }

  if (currentRestoredTransId) return;
  isLongPress = false;
  holdTimer = setTimeout(function() {
    isLongPress = true;
    openHoldCustomModal(productId);
  }, 500);
}

function endHold(productId, isTouch) {
  clearTimeout(holdTimer);

  if (!isTouch && isTouchAction) {
    // Abaikan onmouseup buatan browser mobile
    return;
  }

  if (currentRestoredTransId) {
    return showAlert('Pesanan dari Hold/Pending di-kunci. Tidak bisa menambah menu baru!', 'Peringatan', 'error');
  }
  if (!isLongPress) { directAddToCart(productId); }

  // Reset penanda setelah beberapa saat
  setTimeout(function() { isTouchAction = false; }, 300);
}

function filterCatalogMenu() {
  var keyword = document.getElementById('menu-search-input').value.toLowerCase().trim();
  if (!keyword) {
    renderCatalog(productsData);
  } else {
    var filtered = productsData.filter(p => 
      p.nama.toLowerCase().includes(keyword) || 
      p.kategori.toLowerCase().includes(keyword)
    );
    renderCatalog(filtered);
  }
}

// CART & MODIFIER CONTROL
function startHold(productId) {
  if (currentRestoredTransId) return;
  isLongPress = false;
  holdTimer = setTimeout(function() {
    isLongPress = true;
    openHoldCustomModal(productId);
  }, 500);
}

function endHold(productId) {
  clearTimeout(holdTimer);
  if (currentRestoredTransId) {
    return showAlert('Pesanan dari Hold/Pending di-kunci. Tidak bisa menambah menu baru!', 'Peringatan', 'error');
  }
  if (!isLongPress) { directAddToCart(productId); }
}

function cancelHold() { clearTimeout(holdTimer); }

function directAddToCart(productId) {
  var prod = productsData.find(p => p.id === productId);
  if (!prod) return;

  var existing = currentCart.find(i => i.id === productId && (!i.notes || i.notes === "Normal"));

  if (existing) {
    existing.qty += 1;
  } else {
    currentCart.push({
      cartItemId: Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      id: prod.id,
      nama: prod.nama,
      harga: prod.harga,
      qty: 1,
      notes: "Normal"
    });
  }
  updateCartUI();
}

function openHoldCustomModal(productId) {
  modalTriggerSource = 'HOLD';
  activeProductId = productId;
  holdCustomQty = 1;
  resetChips();

  var prod = productsData.find(p => p.id === productId);
  document.getElementById('custom-modal-title').innerText = 'Custom: ' + prod.nama;
  
  document.getElementById('hold-qty-val').innerText = '1';
  document.getElementById('mode-hold-group').classList.remove('hidden');
  document.getElementById('mode-cart-group').classList.add('hidden');
  
  document.getElementById('custom-modal').classList.remove('hidden');
}

function openCartCustomModal(index) {
  if (currentRestoredTransId) {
    return showAlert('Pesanan di-kunci. Modifikasi menu di-nonaktifkan!', 'Peringatan', 'error');
  }
  modalTriggerSource = 'CART';
  activeCartIndex = index;
  resetChips();

  var item = currentCart[index];
  document.getElementById('custom-modal-title').innerText = 'Custom: ' + item.nama;
  
  var select = document.getElementById('custom-apply-qty');
  select.innerHTML = '';
  for (var i = 1; i <= item.qty; i++) {
    select.innerHTML += `<option value="${i}">${i} Pcs ${i === item.qty ? '(Semua)' : ''}</option>`;
  }
  select.value = item.qty;

  document.getElementById('mode-hold-group').classList.add('hidden');
  document.getElementById('mode-cart-group').classList.remove('hidden');
  
  document.getElementById('custom-modal').classList.remove('hidden');
}

function adjustHoldQty(delta) {
  holdCustomQty = Math.max(1, holdCustomQty + delta);
  document.getElementById('hold-qty-val').innerText = holdCustomQty;
}

function resetChips() {
  selectedIce = "Normal Ice";
  selectedSugar = "Normal Sugar";
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.chip-group').forEach(grp => grp.children[0].classList.add('selected'));
}

function selectChip(el, type, val) {
  var parent = el.parentElement;
  parent.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  if (type === 'ice') selectedIce = val;
  if (type === 'sugar') selectedSugar = val;
}

function saveCustomModifier() {
  var newNote = `${selectedIce}, ${selectedSugar}`;

  if (modalTriggerSource === 'HOLD') {
    var prod = productsData.find(p => p.id === activeProductId);
    currentCart.push({
      cartItemId: Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      id: prod.id,
      nama: prod.nama,
      harga: prod.harga,
      qty: holdCustomQty,
      notes: newNote
    });
  } else if (modalTriggerSource === 'CART') {
    var targetItem = currentCart[activeCartIndex];
    var applyQty = Number(document.getElementById('custom-apply-qty').value);

    if (applyQty === targetItem.qty) {
      targetItem.notes = newNote;
    } else {
      targetItem.qty -= applyQty;
      currentCart.push({
        cartItemId: Date.now() + '_split',
        id: targetItem.id,
        nama: targetItem.nama,
        harga: targetItem.harga,
        qty: applyQty,
        notes: newNote
      });
    }
  }

  closeModal('custom-modal');
  updateCartUI();
}

function updateCartUI() {
  var container = document.getElementById('cart-items');
  var btnRedText = document.getElementById('btnRedText');

  if (currentCart.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin-top: 40px; font-size:13px; font-weight: 700;">Keranjang masih kosong</p>';
    document.getElementById('cart-total-val').innerText = 'Rp 0';
    if (btnRedText) btnRedText.innerText = 'Batal';
    return;
  }

  if (btnRedText) btnRedText.innerText = 'Clear';

  var total = 0;
  container.innerHTML = currentCart.map((item, idx) => {
    var subtotal = item.harga * item.qty;
    total += subtotal;
    var isLocked = currentRestoredTransId !== null;

    return `
      <div class="cart-item">
        <div class="cart-item-left">
          <span class="cart-item-title">${item.nama}</span>
          ${item.notes !== "Normal" ? `
            <div class="cart-item-notes">
              <span>${item.notes}</span>
            </div>
          ` : ''}
          ${!isLocked ? `
            <button onclick="openCartCustomModal(${idx})" class="btn-custom">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Custom
            </button>
          ` : ''}
        </div>

        <div class="cart-item-right">
          <div class="qty-control">
            ${!isLocked ? `<button class="btn-qty" onclick="updateQty(${idx}, -1)">-</button>` : ''}
            <span class="qty-num">${item.qty}</span>
            ${!isLocked ? `<button class="btn-qty" onclick="updateQty(${idx}, 1)">+</button>` : ''}
          </div>
          <span class="cart-item-price">Rp ${subtotal.toLocaleString('id-ID')}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('cart-total-val').innerText = `Rp ${total.toLocaleString('id-ID')}`;
}

function handleRedButton() {
  if (currentCart.length > 0) {
    clearCart();
  } else {
    showDashboard();
  }
}

function updateQty(index, delta) {
  if (currentRestoredTransId) return;
  currentCart[index].qty += delta;
  if (currentCart[index].qty <= 0) currentCart.splice(index, 1);
  updateCartUI();
}

function clearCart() { 
  currentCart = []; 
  currentRestoredTransId = null;
  updateCartUI(); 
}

function getActiveCustomerName() {
  if (selectedCustomerType === 'REGULAR') {
    return document.getElementById('cust-name').value.trim() || 'Umum';
  } else {
    return document.getElementById('member-search-input').value.trim() || 'Member';
  }
}

// HOLD & PENDING FLOW (ONLINE FIRST)
function savePendingOrder() {
  if (currentCart.length === 0) {
    return showAlert('Keranjang masih kosong, pilih menu terlebih dahulu!', 'Peringatan', 'error');
  }

  if (currentRestoredTransId) {
    return showAlert('Pesanan ini sudah tersimpan di kantung Pending!', 'Informasi', 'info');
  }

  showLoading('Menyimpan Pesanan Pending...');

  var custName = getActiveCustomerName();
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var now = new Date();
  var transId = generateTrxId(); 
  var timeStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');

  var payload = {
    transId: transId,
    kasirId: currentUser ? currentUser.id : 'KASIR-01',
    customerName: custName,
    jenisPelanggan: selectedCustomerType,
    subtotal: subtotal,
    totalAkhir: subtotal,
    items: JSON.parse(JSON.stringify(currentCart))
  };

  var orderData = {
    transId: transId,
    waktu: timeStr,
    kasirId: payload.kasirId,
    customerName: custName,
    jenisPelanggan: selectedCustomerType,
    subtotal: subtotal,
    totalAkhir: subtotal,
    metode: '-',
    cashPaid: 0,
    kembalian: 0,
    status: 'PENDING',
    items: payload.items
  };

  // 1. Simpan ke LocalStorage agar UI langsung ter-update
  activeTransactions.push(orderData);
  localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));

  // 2. Kirim ke Server (Online First)
  if (isOnline()) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'holdTransaction', payload: payload })
    })
    .then(res => res.json())
    .catch(err => {
      console.warn("Gagal terhubung ke Sheet, ditambahkan ke antrean sync offline:", err);
      queueForSync('holdTransaction', payload);
    })
    .finally(() => {
      hideLoading();
      clearCart();
      updateBadges();
      showDashboard();
      showAlert('Pesanan dipindahkan ke kantung Pending!', 'Sukses', 'success');
    });
  } else {
    queueForSync('holdTransaction', payload);
    hideLoading();
    clearCart();
    updateBadges();
    showDashboard();
    showAlert('Pesanan disimpan secara lokal (Offline Mode)!', 'Sukses', 'success');
  }
}

function restorePendingOrder(transId) {
  var target = activeTransactions.find(t => t.transId === transId);
  if (!target) return;

  if (currentCart.length > 0) {
    return showAlert('Selesaikan atau bersihkan keranjang aktif terlebih dahulu!', 'Peringatan', 'error');
  }

  currentCart = JSON.parse(JSON.stringify(target.items));
  currentRestoredTransId = target.transId;

  setActiveHeaderTab(null);
  hideAllViews();
  document.getElementById('new-order-view').classList.remove('hidden');
  document.getElementById('cart-customer-name').innerText = target.customerName;

  updateCartUI();
  showAlert('Pesanan ' + transId + ' dipulihkan ke keranjang.', 'Informasi', 'info');
}

// PAYMENT FLOW (ONLINE FIRST)
function openPaymentModal() {
  if (currentCart.length === 0) {
    return showAlert('Keranjang masih kosong, pilih menu terlebih dahulu!', 'Peringatan', 'error');
  }
  
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  document.getElementById('pay-total-akhir').value = 'Rp ' + subtotal.toLocaleString('id-ID');
  
  var cashInput = document.getElementById('pay-cash-paid');
  var changeInput = document.getElementById('pay-change');
  if (cashInput) cashInput.value = '';
  if (changeInput) {
    changeInput.value = 'Rp 0';
    changeInput.style.color = 'var(--text-dark)';
  }

  // Reset metode bawaan ke CASH saat modal terbuka
  selectPayMethodChip('CASH');

  document.getElementById('payment-modal').classList.remove('hidden');
}

function submitTransaction() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var method = document.getElementById('pay-method').value;
  var rawPaid = document.getElementById('pay-cash-paid').value.replace(/[^0-9]/g, '');
  var cashPaid = method === 'CASH' ? (Number(rawPaid) || 0) : subtotal;
  var custName = getActiveCustomerName();

  if (method === 'CASH' && cashPaid < subtotal) {
    return showAlert('Uang pembayaran masih kurang!', 'Gagal Transaksi', 'error');
  }

  closeModal('payment-modal');
  showLoading('Memproses Pembayaran...');

  var now = new Date();
  var transId = currentRestoredTransId || generateTrxId();
  var timeStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');

  var payload = {
    transId: transId,
    kasirId: currentUser ? currentUser.id : 'KASIR-01',
    customerName: custName,
    jenisPelanggan: selectedCustomerType,
    subtotal: subtotal,
    totalAkhir: subtotal,
    metode: method,
    cashPaid: cashPaid,
    items: JSON.parse(JSON.stringify(currentCart))
  };

  if (currentRestoredTransId) {
    activeTransactions = activeTransactions.filter(function(t) {
      return t.transId !== currentRestoredTransId;
    });
  }

  var orderData = {
    transId: transId,
    waktu: timeStr,
    kasirId: payload.kasirId,
    customerName: custName,
    jenisPelanggan: selectedCustomerType,
    subtotal: subtotal,
    totalAkhir: subtotal,
    metode: method,
    cashPaid: cashPaid,
    kembalian: cashPaid - subtotal,
    status: 'PROSES',
    items: payload.items
  };

  // 1. Simpan ke Local Storage untuk UI
  activeTransactions.push(orderData);
  localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
  lastSuccessfulTransaction = orderData;

  // 2. Eksekusi Online First
  if (isOnline()) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveTransaction', payload: payload })
    })
    .then(res => res.json())
    .catch(err => {
      console.warn("Gagal Sync ke Sheet saat ini, dimasukkan ke antrean sync offline:", err);
      queueForSync('saveTransaction', payload);
    })
    .finally(() => {
      hideLoading();
      currentCart = [];
      currentRestoredTransId = null;
      updateCartUI();
      updateBadges();
      showDashboard();
      showSuccessAlertWithPrint('Transaksi a/n ' + custName + ' Berhasil Diproses!');
    });
  } else {
    queueForSync('saveTransaction', payload);
    hideLoading();
    currentCart = [];
    currentRestoredTransId = null;
    updateCartUI();
    updateBadges();
    showDashboard();
    showSuccessAlertWithPrint('Transaksi a/n ' + custName + ' Berhasil (Offline Mode)!');
  }
}

function finishOrder(transId) {
  var target = activeTransactions.find(function(t) { return t.transId === transId; });
  if (target) {
    target.status = 'SELESAI'; // Ubah status transaksi lokal
    localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
    
    // Perbarui counter badge di header
    updateBadges(); 
    
    // Refresh UI dapur agar card yang selesai hilang dari tab Proses
    renderKitchenListUI(); 
  }

  var payload = { transId: transId, status: 'SELESAI' };

  // Kirim update ke Server / Sync Queue
  if (isOnline()) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'updateOrderStatus', payload: payload })
    })
    .then(function(res) { return res.json(); })
    .catch(function(err) {
      queueForSync('updateOrderStatus', payload);
    });
  } else {
    queueForSync('updateOrderStatus', payload);
  }

  showAlert('Pesanan ' + transId + ' telah Selesai!', 'Sukses', 'success');
}

// Fungsi memilih chip metode pembayaran (CASH / QRIS)
function selectPayMethodChip(method) {
  var hiddenInput = document.getElementById('pay-method');
  var chipCash = document.getElementById('pay-chip-cash');
  var chipQris = document.getElementById('pay-chip-qris');

  if (hiddenInput) hiddenInput.value = method;

  if (method === 'CASH') {
    if (chipCash) chipCash.classList.add('selected');
    if (chipQris) chipQris.classList.remove('selected');
  } else {
    if (chipQris) chipQris.classList.add('selected');
    if (chipCash) chipCash.classList.remove('selected');
  }

  togglePayMethod();
}

function togglePayMethod() {
  var methodInput = document.getElementById('pay-method');
  var method = methodInput ? methodInput.value : 'CASH';
  var cashGroup = document.getElementById('cash-group');
  
  if (method === 'QRIS') {
    if (cashGroup) cashGroup.classList.add('hidden');
  } else {
    if (cashGroup) cashGroup.classList.remove('hidden');
    calculatePayment();
  }
}

function calculatePayment() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var method = document.getElementById('pay-method').value;
  
  if (method === 'CASH') {
    var rawPaid = document.getElementById('pay-cash-paid').value.replace(/[^0-9]/g, '');
    var cashPaid = Number(rawPaid) || 0;
    var change = cashPaid - subtotal;
    var changeElem = document.getElementById('pay-change');

    if (cashPaid === 0) {
      changeElem.value = 'Rp 0';
      changeElem.style.color = 'var(--text-dark)';
    } else if (change < 0) {
      changeElem.value = 'Uang Kurang!';
      changeElem.style.color = '#e53935';
    } else {
      changeElem.value = 'Rp ' + change.toLocaleString('id-ID');
      changeElem.style.color = '#2e7d32';
    }
  }
}

function formatCashInput(input) {
  var rawVal = input.value.replace(/[^0-9]/g, '');
  var numericVal = Number(rawVal) || 0;

  if (numericVal === 0) {
    input.value = '';
  } else {
    input.value = 'Rp ' + numericVal.toLocaleString('id-ID');
  }

  calculatePayment();
}

function selectCashChip(amount) {
  var input = document.getElementById('pay-cash-paid');
  if (input) {
    input.value = 'Rp ' + amount.toLocaleString('id-ID');
    calculatePayment();
  }
}

function selectExactCash() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  selectCashChip(subtotal);
}

// TAB VIEW NAVIGATION
function openPendingTab() {
  setActiveHeaderTab('tab-pending');
  hideAllViews();
  var view = document.getElementById('pending-orders-view');
  if (view) view.classList.remove('hidden');
  renderPendingListUI();
}

function renderPendingListUI() {
  var container = document.getElementById('pending-orders-list');
  if (!container) return;

  var now = new Date();
  var todayYear = now.getFullYear();
  var todayMonth = now.getMonth();
  var todayDate = now.getDate();

  var isToday = function(waktuStr) {
    if (!waktuStr) return true;
    var d = new Date(waktuStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === todayYear && 
             d.getMonth() === todayMonth && 
             d.getDate() === todayDate;
    }
    var datePart = String(waktuStr).split(' ')[0].split('T')[0];
    var todayStr = todayYear + '-' + String(todayMonth + 1).padStart(2, '0') + '-' + String(todayDate).padStart(2, '0');
    return datePart === todayStr;
  };

  var pendingItems = activeTransactions.filter(function(t) {
    return String(t.status).toUpperCase() === 'PENDING' && isToday(t.waktu);
  });

  if (pendingItems.length === 0) {
    container.innerHTML = '<div style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 60px 20px; color: #888; font-weight: 600;">Tidak ada pesanan pending saat ini.</div>';
    return;
  }

  container.innerHTML = pendingItems.map(function(t) {
    var itemsList = Array.isArray(t.items) ? t.items : [];

    return `
      <div style="background:#fff; border:1px solid #e0e0e0; border-radius:12px; padding:16px; box-shadow:0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="font-weight:700; color:#333;">${t.transId}</span>
          <span style="background:#fff8e1; color:#f57c00; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">PENDING</span>
        </div>
        <div style="font-size:13px; color:#555; margin-bottom:4px;">Pelanggan: <b>${t.customerName || 'Umum'}</b></div>
        <div style="font-size:12px; color:#888; margin-bottom:10px;">Waktu: ${t.waktu || '-'}</div>

        <!-- RINCIAN PESANAN -->
        <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:12px; font-size:13px;">
          ${itemsList.length > 0 ? itemsList.map(function(i) {
            return `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span><b>${i.qty || 1}x</b> ${i.nama || 'Menu'}</span>
              <span style="font-size:11px; color:#333; font-weight: 800;">
                ${i.notes && i.notes !== 'Normal' ? `(${i.notes})` : ''}
              </span>
            </div>`;
          }).join('') : '<span style="color:#888; font-size:12px;">Detail item tidak tersedia</span>'}
        </div>
        
        <div style="font-size:15px; font-weight:800; color:#2e7d32; margin-bottom:12px;">Rp ${Number(t.totalAkhir || 0).toLocaleString('id-ID')}</div>
        
        <!-- TOMBOL MENTOK BAWAH -->
        <button onclick="restorePendingOrder('${t.transId}')" style="width:100%; background:var(--primary-pink, #d81b60); color:#fff; border:none; padding:10px; border-radius:8px; font-weight:700; cursor:pointer; margin-top: auto;">
          Restore ke Keranjang
        </button>
      </div>
    `;
  }).join('');
}

function openKitchenTab() {
  setActiveHeaderTab('tab-kitchen');
  hideAllViews();
  var view = document.getElementById('kitchen-orders-view');
  if (view) view.classList.remove('hidden');
  renderKitchenListUI();
}

// 1. RENDER CARD PROSES DENGAN WAKTU, TOTAL, & TOMBOL BERDAMPINGAN
function renderKitchenListUI() {
  var container = document.getElementById('kitchen-orders-list');
  if (!container) return;

  var prosesItems = activeTransactions.filter(function(t) {
    return String(t.status || '').toUpperCase() === 'PROSES';
  });

  if (prosesItems.length === 0) {
    container.innerHTML = '<div style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 60px 20px; color: #888; font-weight: 600;">Tidak ada antrian pesanan yang diproses.</div>';
    return;
  }

  container.innerHTML = prosesItems.map(function(t) {
    var itemsList = Array.isArray(t.items) ? t.items : [];

    return `
      <div style="background:#fff; border:1px solid #c8e6c9; border-radius:12px; padding:16px; box-shadow:0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="font-weight:700; color:#333;">${t.transId}</span>
          <span style="background:#e8f5e9; color:#2e7d32; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">PROSES</span>
        </div>
        <div style="font-size:13px; color:#333; margin-bottom:4px;">Customer: <b>${t.customerName || 'Umum'}</b></div>
        <div style="font-size:12px; color:#666; margin-bottom:4px;">Metode: <b>${t.metode || 'CASH'}</b></div>
        <div style="font-size:12px; color:#888; margin-bottom:10px;">Waktu: ${t.waktu || '-'}</div>
        
        <!-- DETAIL ITEMS -->
        <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:12px; font-size:13px;">
          ${itemsList.length > 0 ? itemsList.map(function(i) {
            return `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span><b>${i.qty || 1}x</b> ${i.nama || 'Menu'}</span>
              <span style="font-size:11px; color:#333; font-weight: 800;">
                ${i.notes && i.notes !== 'Normal' ? `(${i.notes})` : ''}
              </span>
            </div>`;
          }).join('') : '<span style="color:#888; font-size:12px;">Detail item tidak tersedia</span>'}
        </div>

        <!-- TOTAL HARGA -->
        <div style="font-size:15px; font-weight:800; color:#2e7d32; margin-bottom:12px;">
          Rp ${Number(t.totalAkhir || 0).toLocaleString('id-ID')}
        </div>

        <!-- TOMBOL MENTOK BAWAH (margin-top: auto) -->
        <div style="display:flex; gap:8px; margin-top: auto;">
          <button onclick="reprintReceipt('${t.transId}')" style="flex:1; background:#eee; color:#333; border:none; padding:10px 6px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
            Cetak Struk
          </button>
          <button onclick="finishOrder('${t.transId}')" style="flex:1; background:#2e7d32; color:#fff; border:none; padding:10px 6px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
            Pesanan Selesai
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// 2. FUNGSI CETAK ULANG STRUK DARI CARD
function reprintReceipt(transId) {
  var target = activeTransactions.find(function(t) { return t.transId === transId; });
  if (!target) {
    showAlert('Data transaksi tidak ditemukan!', 'Error', 'error');
    return;
  }

  lastSuccessfulTransaction = target;
  // printReceipt();
  printReceiptDirect();
}

function openCompletedOrdersTab() {
  setActiveHeaderTab('tab-completed');
  hideAllViews();
  var view = document.getElementById('completed-orders-view');
  if (view) view.classList.remove('hidden');
  renderCompletedOrdersUI();
}

function renderCompletedOrdersUI() {
  var container = document.getElementById('completed-orders-list');
  if (!container) return;

  var now = new Date();
  var todayYear = now.getFullYear();
  var todayMonth = now.getMonth();
  var todayDate = now.getDate();

  var isToday = function(waktuStr) {
    if (!waktuStr) return true;
    var d = new Date(waktuStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === todayYear && 
             d.getMonth() === todayMonth && 
             d.getDate() === todayDate;
    }
    var datePart = String(waktuStr).split(' ')[0].split('T')[0];
    var todayStr = todayYear + '-' + String(todayMonth + 1).padStart(2, '0') + '-' + String(todayDate).padStart(2, '0');
    return datePart === todayStr;
  };

  var completedItems = activeTransactions.filter(function(t) {
    return String(t.status || '').trim().toUpperCase() === 'SELESAI' && isToday(t.waktu);
  });

  if (completedItems.length === 0) {
    container.innerHTML = '<div style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 60px 20px; color: #888; font-weight: 600;">Belum ada pesanan yang selesai hari ini.</div>';
    return;
  }

  container.innerHTML = completedItems.map(function(t) {
    var itemsList = Array.isArray(t.items) ? t.items : [];

    return `
      <div style="background:#fff; border:1px solid #d1c4e9; border-radius:12px; padding:16px; box-shadow:0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="font-weight:700; color:#333;">${t.transId}</span>
          <span style="background:#ede7f6; color:#5e35b1; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">SELESAI</span>
        </div>
        <div style="font-size:13px; color:#333; margin-bottom:4px;">Customer: <b>${t.customerName || 'Umum'}</b></div>
        <div style="font-size:12px; color:#666; margin-bottom:4px;">Metode: <b>${t.metode || 'CASH'}</b></div>
        <div style="font-size:12px; color:#888; margin-bottom:10px;">Waktu: ${t.waktu || '-'}</div>
        
        <!-- DETAIL ITEMS -->
        <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:12px; font-size:13px;">
          ${itemsList.length > 0 ? itemsList.map(function(i) {
            return `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span><b>${i.qty || 1}x</b> ${i.nama || 'Menu'}</span>
              <span style="font-size:11px; color:#333; font-weight: 800;">${i.notes && i.notes !== 'Normal' ? `(${i.notes})` : ''}</span>
            </div>`;
          }).join('') : '<span style="color:#888; font-size:12px;">Detail item tidak tersedia</span>'}
        </div>

        <!-- TOTAL HARGA & STATUS FOOTER (MENTOK BAWAH) -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top: auto;">
          <span style="font-size:15px; font-weight:800; color:#2e7d32;">Rp ${Number(t.totalAkhir || 0).toLocaleString('id-ID')}</span>
          <span style="font-size:11px; color:#888; font-weight: 600;">✓ Selesai diproses</span>
        </div>
      </div>
    `;
  }).join('');
}

// ALERT & NOTIFICATION UTILS
function showAlert(message, title, type) {
  var modal = document.getElementById('custom-alert-modal');
  var titleEl = document.getElementById('alert-modal-title');
  var msgEl = document.getElementById('alert-modal-message');
  var iconContainer = document.getElementById('alert-icon-container');
  var btnContainer = document.getElementById('alert-action-buttons');

  if (titleEl) titleEl.innerText = title || 'Notifikasi';
  if (msgEl) msgEl.innerText = message;

  if (iconContainer) {
    if (type === 'error') {
      iconContainer.innerHTML = '<div style="width: 42px; height: 42px; background: #ffebee; color: #c62828; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; font-size: 20px; font-weight: bold;">✕</div>';
    } else if (type === 'success') {
      iconContainer.innerHTML = '<div style="width: 42px; height: 42px; background: #e8f5e9; color: #2e7d32; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; font-size: 20px; font-weight: bold;">✓</div>';
    } else {
      iconContainer.innerHTML = '<div style="width: 42px; height: 42px; background: #e3f2fd; color: #1565c0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; font-size: 20px; font-weight: bold;">i</div>';
    }
  }

  if (btnContainer) {
    btnContainer.innerHTML = `
      <button type="button" onclick="closeCustomAlert()" class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 13px; font-weight: 800;">OK</button>
    `;
  }

  if (modal) modal.classList.remove('hidden');
}

function showSuccessAlertWithPrint(message) {
  var modal = document.getElementById('custom-alert-modal');
  var titleEl = document.getElementById('alert-modal-title');
  var msgEl = document.getElementById('alert-modal-message');
  var iconContainer = document.getElementById('alert-icon-container');
  var btnContainer = document.getElementById('alert-action-buttons');

  if (titleEl) titleEl.innerText = 'Sukses';
  if (msgEl) msgEl.innerText = message;
  
  if (iconContainer) {
    iconContainer.innerHTML = '<div style="width: 42px; height: 42px; background: #e8f5e9; color: #2e7d32; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; font-size: 20px; font-weight: bold;">✓</div>';
  }

  if (btnContainer) {
    btnContainer.innerHTML = `
      <button type="button" onclick="printReceiptDirect()" class="btn btn-secondary" style="flex: 1; padding: 10px; font-size: 12px; font-weight: 800; background: #eee; color: #333; border: none; border-radius: 6px; cursor: pointer;">Cetak Struk</button>
      <button type="button" onclick="closeCustomAlert()" class="btn btn-primary" style="flex: 1; padding: 10px; font-size: 12px; font-weight: 800;">OK</button>
    `;
  }

  if (modal) modal.classList.remove('hidden');
}

function printReceipt() {
  if (!lastSuccessfulTransaction) {
    alert('Data transaksi tidak ditemukan.');
    return;
  }

  var t = lastSuccessfulTransaction;

  // 1. Header Metadata
  var metaHTML = `
    <div>ID Pesanan: <b>${t.transId}</b></div>
    <div>Tanggal: ${t.waktu || '-'}</div>
    <div>Kasir: ${currentUser ? currentUser.nama : 'Kasir'}</div>
    <div>Customer: <b>${t.customerName}</b></div>
  `;
  document.getElementById('receipt-meta').innerHTML = metaHTML;

  // 2. Rincian Items + Catatan
  var itemsHTML = '';
  if (t.items && t.items.length > 0) {
    t.items.forEach(function(item) {
      var itemTotal = item.harga * item.qty;
      var notesText = (item.notes && item.notes !== 'Normal') 
        ? `<div style="font-size: 8px; color: #444; font-style: italic; padding-left: 8px;">* ${item.notes}</div>` 
        : '';

      itemsHTML += `
        <div style="margin-bottom: 5px;">
          <div style="font-weight: bold;">${item.nama}</div>
          <div style="display: flex; justify-content: space-between;">
            <span>${item.qty}x @${Number(item.harga).toLocaleString('id-ID')}</span>
            <span><b>Rp ${itemTotal.toLocaleString('id-ID')}</b></span>
          </div>
          ${notesText}
        </div>
      `;
    });
  }
  document.getElementById('receipt-items').innerHTML = itemsHTML;

  // 3. Totals
  var totalsHTML = `
    <div style="display: flex; justify-content: space-between;"><span>Metode:</span><span><b>${t.metode}</b></span></div>
    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 10px; margin-top: 2px;"><span>Total:</span><span>Rp ${Number(t.totalAkhir).toLocaleString('id-ID')}</span></div>
  `;
  
  if (t.metode === 'CASH') {
    totalsHTML += `
      <div style="display: flex; justify-content: space-between;"><span>Tunai:</span><span>Rp ${Number(t.cashPaid || 0).toLocaleString('id-ID')}</span></div>
      <div style="display: flex; justify-content: space-between;"><span>Kembalian:</span><span>Rp ${Number(t.kembalian || 0).toLocaleString('id-ID')}</span></div>
    `;
  }
  document.getElementById('receipt-totals').innerHTML = totalsHTML;

  // 4. Tutup Alert Modal
  closeCustomAlert();

  // 5. Pastikan Class Hidden-Print Dilepas Pas Mau Print
  var receiptArea = document.getElementById('receipt-print-area');
  if (receiptArea) {
    receiptArea.classList.remove('hidden-print');
  }

  // 6. Eksekusi Cetak & Sembunyikan Kembali Setelah Print
  setTimeout(function() {
    window.print();
    
    // Kembalikan class hidden-print setelah dialog print ditutup
    if (receiptArea) {
      receiptArea.classList.add('hidden-print');
    }
  }, 300);
}

function closeCustomAlert() {
  document.getElementById('custom-alert-modal').classList.add('hidden');
}

function closeModal(id) { 
  document.getElementById(id).classList.add('hidden'); 
}

function showLoading(text) {
  var loadingText = document.getElementById('global-loading-text');
  if (loadingText && text) loadingText.innerText = text;
  var loadingModal = document.getElementById('global-loading-modal');
  if (loadingModal) loadingModal.classList.remove('hidden');
}

function hideLoading() {
  var loadingModal = document.getElementById('global-loading-modal');
  if (loadingModal) loadingModal.classList.add('hidden');
}

function generateTrxId() {
  var now = new Date();
  var yy = String(now.getFullYear()).slice(-2);
  var mm = String(now.getMonth() + 1).padStart(2, '0');
  var dd = String(now.getDate()).padStart(2, '0');
  var todayStr = yy + mm + dd;

  var lastDate = localStorage.getItem('pos_last_date');
  var counter = parseInt(localStorage.getItem('pos_trx_counter') || '0', 10);

  if (lastDate !== todayStr) {
    lastDate = todayStr;
    counter = 1;
  } else {
    counter += 1;
  }

  localStorage.setItem('pos_last_date', lastDate);
  localStorage.setItem('pos_trx_counter', counter);

  return 'QSK-' + todayStr + '-' + String(counter).padStart(3, '0');
}

window.addEventListener('beforeunload', function (e) {
  if (currentCart && currentCart.length > 0) {
    e.preventDefault();
    e.returnValue = 'Masih ada transaksi di keranjang! Yakin ingin keluar?';
    return e.returnValue;
  }
});

// SINKRONISASI TAB ACTIVE (DESKTOP & MOBILE)
function setActiveHeaderTab(tabId) {
  // Reset Desktop Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (tabId) {
    var target = document.getElementById(tabId);
    if (target) target.classList.add('active');
  }

  // Reset Mobile Bottom Nav Tabs
  document.querySelectorAll('.bottom-nav-item').forEach(btn => btn.classList.remove('active'));
  var mobileTabId = tabId ? 'mobile-' + tabId : 'mobile-tab-home';
  var mobileTarget = document.getElementById(mobileTabId);
  if (mobileTarget) mobileTarget.classList.add('active');
}

// SINKRONISASI BADGE COUNT (DESKTOP & MOBILE)
function updateBadges() {
  var now = new Date();
  var todayYear = now.getFullYear();
  var todayMonth = now.getMonth();
  var todayDate = now.getDate();

  var isToday = function(waktuStr) {
    if (!waktuStr) return false;
    var d = new Date(waktuStr);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === todayYear && 
             d.getMonth() === todayMonth && 
             d.getDate() === todayDate;
    }
    var datePart = String(waktuStr).split(' ')[0].split('T')[0];
    var todayStr = todayYear + '-' + String(todayMonth + 1).padStart(2, '0') + '-' + String(todayDate).padStart(2, '0');
    return datePart === todayStr;
  };

  var pendingCount = activeTransactions.filter(t => String(t.status).toUpperCase() === 'PENDING' && isToday(t.waktu)).length;
  var prosesCount = activeTransactions.filter(t => String(t.status).toUpperCase() === 'PROSES').length;
  var selesaiCount = activeTransactions.filter(t => String(t.status).toUpperCase() === 'SELESAI' && isToday(t.waktu)).length;

  // Render Badges Desktop & Mobile
  var updateBadgeUI = function(desktopId, mobileId, count) {
    var deskEl = document.getElementById(desktopId);
    var mobEl = document.getElementById(mobileId);

    if (deskEl) {
      deskEl.innerText = count;
      deskEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (mobEl) {
      mobEl.innerText = count;
      mobEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
  };

  updateBadgeUI('badge-pending', 'mobile-badge-pending', pendingCount);
  updateBadgeUI('badge-proses', 'mobile-badge-proses', prosesCount);
  updateBadgeUI('badge-selesai', 'mobile-badge-selesai', selesaiCount);
}

// TOGGLE SLIDE-UP CART DI MOBILE (DI-CLICK DARI HEADER CARI KERANJANG)
function toggleMobileCart() {
  var cartSec = document.querySelector('.cart-section');
  if (cartSec) {
    cartSec.classList.toggle('mobile-expanded');
  }
}


// Buka / Tutup Bottom Sheet Keranjang di Mobile
function toggleMobileCart() {
  if (window.innerWidth <= 768) {
    var cartSec = document.querySelector('.cart-section');
    if (cartSec) {
      cartSec.classList.toggle('mobile-expanded');
    }
  }
}

// Menjaga agar klik tombol di dalam keranjang tidak memicu toggle buka-tutup
function handleCartClick(e) {
  if (window.innerWidth <= 768) {
    // Jika mengeklik tombol atau footer, jangan jalankan toggle
    if (e.target.closest('.cart-footer') || e.target.closest('.btn-qty') || e.target.closest('.btn-custom')) {
      e.stopPropagation();
    }
  }
}

// Helper untuk Load Image/Base64 ke Canvas (Maksimal 250px biar pas di tengah kertas 58mm)
function loadLogoToCanvas(imageSrc, maxWidth = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // 1. Resize proporsional
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      // 2. WAJIB: Bulatkan Width & Height ke kelipatan 8 terdekat
      width = Math.floor(width / 8) * 8;
      height = Math.floor(height / 8) * 8;

      // Safety check minimal 8px
      if (width < 8) width = 8;
      if (height < 8) height = 8;

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      // Latar belakang putih murni
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas);
    };
    img.onerror = (err) => reject(err);
    img.src = imageSrc;
  });
}

function formatDateCustom(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return dateInput; // Fallback jika string tanggal mentah

  const pad = (num) => String(num).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// Variable Global Koneksi
let btDevice = null;
let btCharacteristic = null;

async function printReceiptDirect() {
  if (!lastSuccessfulTransaction) {
    showAlert('Data transaksi tidak ditemukan.', 'Error', 'error');
    return;
  }

  showLoading('Menghubungkan ke Printer...');

  try {
    if (!btCharacteristic || !btDevice || !btDevice.gatt.connected) {
      await connectWebBluetooth();
    }

    showLoading('Memproses Data Cetak...');

    let logoCanvas = null;
    if (typeof APP_ASSETS !== 'undefined' && APP_ASSETS.logoStruk) {
      try {
        logoCanvas = await loadLogoToCanvas(APP_ASSETS.logoStruk, 240);
      } catch (e) {
        console.warn("Gagal load logo, cetak teks saja", e);
      }
    }

    const encoder = new EscPosEncoder();
    const t = lastSuccessfulTransaction;

    let receipt = encoder.initialize().codepage('cp437').align('center');

// 1. HEADER & LOGO
    if (logoCanvas) {
      receipt
        .image(logoCanvas, logoCanvas.width, logoCanvas.height, 'threshold')
        .newline();
    } else {
      receipt.bold(true).line('QISKI JUICE').bold(false);
    }

    // Alamat Toko: Pakai Font B (Kecil/Ringkas)
    receipt
      .font('b')
      .line('Jl. Parakan Saat, Cisaranten Endah')
      .line('Arcamanik, Kota Bandung')
      .font('a') // Kembalikan ke Font A
      .line('--------------------------------')

      // 2. METADATA
      .align('left')
      .line(`ID Pesanan : ${t.transId}`)
      .line(`Tanggal    : ${formatDateCustom(t.waktu)}`)
      .line(`Customer   : ${t.customerName}`)
      .line('--------------------------------');

    // 3. ITEMS
    if (t.items && t.items.length > 0) {
      t.items.forEach(item => {
        const itemTotal = item.harga * item.qty;
        const priceDetail = `${item.qty}x @${Number(item.harga).toLocaleString('id-ID')}`;
        const totalPrice = `Rp ${itemTotal.toLocaleString('id-ID')}`;

        receipt
          .bold(true)
          .line(item.nama)
          .bold(false)
          .line(formatTwoColumns(priceDetail, totalPrice));

        // Catatan Item: Pakai Font B (Kecil/Ringkas)
        if (item.notes && item.notes !== 'Normal') {
          receipt
            .font('b')
            .line(`  └ ${item.notes}`)
            .font('a'); // Kembalikan ke Font A
        }
      });
    }

    // 4. TOTAL & PEMBAYARAN
    receipt
      .line('--------------------------------')
      .bold(true)
      .size(1, 1)
      .line(formatTwoColumns('TOTAL', `Rp ${Number(t.totalAkhir).toLocaleString('id-ID')}`))
      .size(0, 0)
      .bold(false)
      .line(formatTwoColumns('Metode', t.metode));

    if (t.metode === 'CASH') {
      receipt
        .line(formatTwoColumns('Tunai', `Rp ${Number(t.cashPaid || 0).toLocaleString('id-ID')}`))
        .line(formatTwoColumns('Kembali', `Rp ${Number(t.kembalian || 0).toLocaleString('id-ID')}`));
    }

    // 5. FOOTER
    receipt
      .line('--------------------------------')
      .align('center')
      .line('Terima Kasih!')
      .line('WA: 081234567890')
      .newline()
      .newline()
      .newline()
      .newline();

    const dataByte = receipt.encode();
    await sendByteChunks(dataByte);

    hideLoading();
    showAlert('Struk berhasil dicetak!', 'Sukses', 'success');

  } catch (err) {
    hideLoading();
    console.error("Web Bluetooth Error:", err);
    showAlert('Gagal Cetak Direct: ' + err.message, 'Bluetooth Error', 'error');
  }
}

// FUNGSI KONEKSI WEB BLUETOOTH AUTOMATIC DISCOVERY
async function connectWebBluetooth() {
  // Minta browser scan semua perangkat Bluetooth
  btDevice = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '0000ff00-0000-1000-8000-00805f9b34fb',
      '0000ffe0-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-435e-8ab0-99161392650e'
    ]
  });

  const server = await btDevice.gatt.connect();
  const services = await server.getPrimaryServices();

  // Cari Karakteristik yang Punya Izin 'Write' Secara Otomatis
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const char of characteristics) {
      if (char.properties.write || char.properties.writeWithoutResponse) {
        btCharacteristic = char;
        break;
      }
    }
    if (btCharacteristic) break;
  }

  if (!btCharacteristic) {
    throw new Error('Karakteristik cetak printer tidak ditemukan.');
  }
}

// SEND CHUNKS PER 20 BYTE DENGAN DELAY 50MS
async function sendByteChunks(bytes) {
  const chunkSize = 20; // Ukuran aman memori RPP02N
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    const arrayBuffer = new Uint8Array(chunk).buffer;

    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(arrayBuffer);
    } else {
      await btCharacteristic.writeValue(arrayBuffer);
    }
    
    // Delay wajib agar chip printer tidak mogok
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}


// Helper untuk membuat teks Rata Kiri & Kanan (Maksimal 32 karakter untuk kertas 58mm)
function formatTwoColumns(leftText, rightText, maxChars = 32) {
  let spaceNeeded = maxChars - leftText.length - rightText.length;
  if (spaceNeeded < 1) spaceNeeded = 1;
  return leftText + ' '.repeat(spaceNeeded) + rightText;
}
