var API_URL = "https://script.google.com/macros/s/AKfycbwHA9QpcBwA-4vtFANUYDkUp_rJIxw0NilgbmxqSmgrTJWasiJ5_O_aGCT20QCnki1BjA/exec";

// Global State Data
var productsData = [];
var membersData = [];
var activeTransactions = []; // Menyimpan data pending & proses

var currentUser = null;
var currentCart = []; // KUNCI: Hanya menggunakan 1 variabel tunggal ini
var selectedCustomerType = 'REGULAR';
var selectedMemberId = null;
var currentRestoredTransId = null; // Stays NOT NULL jika order direstore dari Pending

// Modal & Customization State
var modalTriggerSource = null; 
var activeCartIndex = null;
var activeProductId = null;
var holdCustomQty = 1;
var selectedIce = "Normal Ice";
var selectedSugar = "Normal Sugar";

var holdTimer = null;
var isLongPress = false;

// INITIALIZATION & SESSION MANAGEMENT
document.addEventListener("DOMContentLoaded", function() {
  checkExistingSession();
  loadDataFromSheet();
  
  // Auto sync saat koneksi kembali online
  window.addEventListener('online', function() {
    showAlert('Koneksi internet kembali! Mengirim data antrean...', 'Online', 'info');
    processSyncQueue();
  });
});

function checkExistingSession() {
  var savedSession = localStorage.getItem('qiski_session');
  if (savedSession) {
    currentUser = JSON.parse(savedSession);
    document.getElementById('user-display').innerText = currentUser.nama;
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-page').classList.remove('hidden');
    showDashboard();
  }
}

function handleLogin(e) {
  e.preventDefault();
  var u = document.getElementById('username').value;
  var p = document.getElementById('password').value;

  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'checkLogin', username: u, password: p })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      currentUser = res.user;
      localStorage.setItem('qiski_session', JSON.stringify(currentUser));
      document.getElementById('user-display').innerText = currentUser.nama;
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('app-page').classList.remove('hidden');
      showDashboard();
    } else { 
      showAlert(res.message, 'Gagal Login', 'error'); 
    }
  })
  .catch(err => {
    showAlert('Gagal terhubung ke server: ' + err.toString(), 'Error', 'error');
  });
}

function logout() { 
  localStorage.removeItem('qiski_session'); 
  location.reload(); 
}

// DATA FETCHING & LOCALSTORAGE SYNC ENGINE
function loadDataFromSheet() {
  var localActive = localStorage.getItem('pos_active_orders');
  if (localActive) {
    activeTransactions = JSON.parse(localActive);
    updateBadges();
  }

  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'getInitialData' })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success && res.data) {
      productsData = res.data.products || [];
      membersData = res.data.members || [];
      if (res.data.activeTransactions) {
        activeTransactions = res.data.activeTransactions;
        localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
      }
      renderCatalog();
      updateBadges();
      processSyncQueue();
    }
  })
  .catch(err => console.warn("Menggunakan data lokal (Offline Mode):", err));
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
  processSyncQueue();
}

function processSyncQueue() {
  if (!isOnline()) return;

  var queue = JSON.parse(localStorage.getItem('pos_sync_queue') || '[]');
  if (queue.length === 0) return;

  var item = queue[0];

  fetch(API_URL, {
    method: 'POST',
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
      } else {
        fetch(API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'getInitialData' })
        })
        .then(r => r.json())
        .then(r => {
          if (r.success && r.data.activeTransactions) {
            activeTransactions = r.data.activeTransactions;
            localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
            updateBadges();
          }
        });
      }
    }
  })
  .catch(err => console.warn('Background sync deferred:', err));
}

function updateBadges() {
  var now = new Date();
  var todayYear = now.getFullYear();
  var todayMonth = now.getMonth();
  var todayDate = now.getDate();

  var pendingCount = activeTransactions.filter(function(t) {
    if (t.status !== 'PENDING') return false;
    if (!t.waktu) return true;

    var d = new Date(t.waktu);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() === todayYear && 
             d.getMonth() === todayMonth && 
             d.getDate() === todayDate;
    }
    
    var datePart = String(t.waktu).split(' ')[0].split('T')[0];
    var todayStr = todayYear + '-' + String(todayMonth + 1).padStart(2, '0') + '-' + String(todayDate).padStart(2, '0');
    return datePart === todayStr;
  }).length;

  var prosesCount = activeTransactions.filter(function(t) {
    return t.status === 'PROSES';
  }).length;

  var pendingBadge = document.getElementById('badge-pending');
  var prosesBadge = document.getElementById('badge-proses');

  if (pendingBadge) {
    pendingBadge.innerText = pendingCount;
    pendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
  if (prosesBadge) {
    prosesBadge.innerText = prosesCount;
    prosesBadge.style.display = prosesCount > 0 ? 'inline-block' : 'none';
  }
}

// HEADER TAB & ROUTING MANAGEMENT
function setActiveHeaderTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (tabId) {
    var target = document.getElementById(tabId);
    if (target) target.classList.add('active');
  }
}

function hideAllViews() {
  var views = ['home-dashboard-view', 'new-order-view', 'pending-orders-view', 'kitchen-orders-view'];
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
      showAlert('Silakan masukkan nama pelanggan terlebih dahulu!', 'Peringatan', 'error');
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

  var loadingOverlay = document.getElementById('gate-loading-overlay');
  loadingOverlay.classList.remove('hidden');

  setTimeout(function() {
    loadingOverlay.classList.add('hidden');
    closeModal('customer-gate-modal');

    setActiveHeaderTab(null);
    hideAllViews();
    document.getElementById('new-order-view').classList.remove('hidden');

    document.getElementById('cart-customer-name').innerText = getActiveCustomerName();
    
    var searchInp = document.getElementById('menu-search-input');
    if (searchInp) searchInp.value = '';

    clearCart();
  }, 400);
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

function renderMemberList(filterText = "") {
  var container = document.getElementById('member-items-list');
  var keyword = filterText.toLowerCase();

  var filtered = membersData.filter(m => 
    (m.nama && m.nama.toLowerCase().includes(keyword)) || 
    (m.hp && String(m.hp).includes(keyword))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 10px 12px; color: var(--text-muted); font-size: 12px; text-align: center;">Member tidak ditemukan</div>`;
    return;
  }

  container.innerHTML = filtered.map(m => `
    <div onclick="selectMember('${m.id}', '${m.nama}', '${m.hp}')" style="padding: 10px 12px; cursor: pointer; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f9f9f9; transition: 0.15s;" onmouseover="this.style.background='#fffaf5'" onmouseout="this.style.background='#fff'">
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
  membersData.push({ id: newId, nama: name, hp: phone, poin: 0 });

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

// CATALOG & MENU RENDERING
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
               onmousedown="startHold('${p.id}')" 
               onmouseup="endHold('${p.id}')" 
               onmouseleave="cancelHold()"
               ontouchstart="startHold('${p.id}')" 
               ontouchend="endHold('${p.id}')"
               ontouchcancel="cancelHold()">
            <h4>${p.nama}</h4>
            <div class="price">Rp ${Number(p.harga).toLocaleString('id-ID')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
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

// CART CUSTOMIZATION & MODIFIER
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

// CART UI & LOCKING MECHANISM
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

function lockCartUI() {
  var btnHold = document.getElementById('btn-hold-cart');
  if (btnHold) btnHold.style.display = 'none';
}

function unlockCartUI() {
  var btnHold = document.getElementById('btn-hold-cart');
  if (btnHold) btnHold.style.display = 'inline-block';
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
  unlockCartUI();
  updateCartUI(); 
}

function getActiveCustomerName() {
  if (selectedCustomerType === 'REGULAR') {
    return document.getElementById('cust-name').value.trim() || 'Umum';
  } else {
    return document.getElementById('member-search-input').value.trim() || 'Member';
  }
}

// HOLD & PENDING FLOW
function savePendingOrder() {
  if (currentCart.length === 0) {
    return showAlert('Keranjang masih kosong, pilih menu terlebih dahulu!', 'Peringatan', 'error');
  }

  if (currentRestoredTransId) {
    return showAlert('Pesanan ini sudah tersimpan di kantung Pending!', 'Informasi', 'info');
  }

  var custName = getActiveCustomerName();
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);

  var loadingOverlay = document.getElementById('gate-loading-overlay');
  if (loadingOverlay) loadingOverlay.classList.remove('hidden');

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

  activeTransactions.push(orderData);
  localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));

// Cukup fetch sekali untuk simpan data ke server
  fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: 'holdTransaction', // atau 'saveTransaction'
      payload: payload
    })
  })
  .then(function(res) { return res.json(); })
  .then(function(result) {
    console.log("Sync Berhasil:", result);
  })
  .catch(function(err) {
    console.error("Gagal Sync ke Sheet, tersimpan di Local Storage:", err);
  })
  .finally(function() {
    // Loading langsung ditutup tanpa nunggu request kedua
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    
    clearCart();
    updateBadges();
    showDashboard();

    showAlert('Berhasil diproses!', 'Sukses', 'success');
  });
}

function restorePendingOrder(transId) {
  var target = activeTransactions.find(t => t.transId === transId);
  if (!target) return;

  if (currentCart.length > 0) {
    return showAlert('Selesaikan atau bersihkan keranjang aktif terlebih dahulu!', 'Peringatan', 'error');
  }

  currentCart = JSON.parse(JSON.stringify(target.items));
  currentRestoredTransId = target.transId;

  lockCartUI();
  
  setActiveHeaderTab(null);
  hideAllViews();
  document.getElementById('new-order-view').classList.remove('hidden');
  document.getElementById('cart-customer-name').innerText = target.customerName;

  updateCartUI();
  showAlert('Pesanan ' + transId + ' dipulihkan ke keranjang (Di-kunci).', 'Informasi', 'info');
}

// PAYMENT FLOW
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

  var methodSelect = document.getElementById('pay-method');
  if (methodSelect) {
    methodSelect.value = 'CASH';
    togglePayMethod();
  }

  document.getElementById('payment-modal').classList.remove('hidden');
}

// PAYMENT FLOW (SUBMIT)
function submitTransaction() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var method = document.getElementById('pay-method').value;
  var rawPaid = document.getElementById('pay-cash-paid').value.replace(/[^0-9]/g, '');
  var cashPaid = method === 'CASH' ? (Number(rawPaid) || 0) : subtotal;
  var custName = getActiveCustomerName();

  if (method === 'CASH' && cashPaid < subtotal) {
    return showAlert('Uang pembayaran masih kurang!', 'Gagal Transaksi', 'error');
  }

  var loadingOverlay = document.getElementById('gate-loading-overlay');
  if (loadingOverlay) loadingOverlay.classList.remove('hidden');

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

  activeTransactions.push(orderData);
  localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));

// Cukup fetch sekali untuk simpan data ke server
  fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify({
      action: 'holdTransaction', // atau 'saveTransaction'
      payload: payload
    })
  })
  .then(function(res) { return res.json(); })
  .then(function(result) {
    console.log("Sync Berhasil:", result);
  })
  .catch(function(err) {
    console.error("Gagal Sync ke Sheet, tersimpan di Local Storage:", err);
  })
  .finally(function() {
    // Loading langsung ditutup tanpa nunggu request kedua
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    
    clearCart();
    updateBadges();
    showDashboard();

    showAlert('Berhasil diproses!', 'Sukses', 'success');
  });
}

function finishOrder(transId) {
  var target = activeTransactions.find(t => t.transId === transId);
  if (target) {
    target.status = 'SELESAI';
    activeTransactions = activeTransactions.filter(t => t.transId !== transId);
    localStorage.setItem('pos_active_orders', JSON.stringify(activeTransactions));
    updateBadges();
    renderKitchenListUI();
  }

  queueForSync('updateOrderStatus', { transId: transId, status: 'SELESAI' });
  showAlert('Pesanan ' + transId + ' telah Selesai!', 'Sukses', 'success');
}

// CALCULATION & PAYMENT HELPERS
function togglePayMethod() {
  var method = document.getElementById('pay-method').value;
  var cashGroup = document.getElementById('cash-group');
  
  if (method === 'QRIS') {
    cashGroup.classList.add('hidden');
  } else {
    cashGroup.classList.remove('hidden');
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

// TAB VIEW NAVIGATION (PENDING & KITCHEN)
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

  var pendingItems = activeTransactions.filter(t => String(t.status).toUpperCase() === 'PENDING');

  if (pendingItems.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 40px; color: #888;">Tidak ada pesanan pending saat ini.</div>';
    return;
  }

  container.innerHTML = pendingItems.map(t => `
    <div style="background:#fff; border:1px solid #e0e0e0; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="font-weight:700; color:#333;">${t.transId}</span>
        <span style="background:#fff8e1; color:#f57c00; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">PENDING</span>
      </div>
      <div style="font-size:13px; color:#555; margin-bottom:4px;">Pelanggan: <b>${t.customerName || 'Umum'}</b> (${t.jenisPelanggan || 'REGULAR'})</div>
      <div style="font-size:12px; color:#888; margin-bottom:8px;">Waktu: ${t.waktu}</div>
      <div style="font-size:14px; font-weight:700; color:#2e7d32; margin-bottom:12px;">Rp ${Number(t.totalAkhir).toLocaleString('id-ID')}</div>
      <button onclick="restorePendingOrder('${t.transId}')" style="width:100%; background:var(--primary-pink, #d81b60); color:#fff; border:none; padding:10px; border-radius:8px; font-weight:600; cursor:pointer;">
        Restore ke Keranjang
      </button>
    </div>
  `).join('');
}

function openKitchenTab() {
  setActiveHeaderTab('tab-kitchen');
  hideAllViews();
  var view = document.getElementById('kitchen-orders-view');
  if (view) view.classList.remove('hidden');
  renderKitchenListUI();
}

function renderKitchenListUI() {
  var container = document.getElementById('kitchen-orders-list');
  if (!container) return;

  var prosesItems = activeTransactions.filter(t => String(t.status).toUpperCase() === 'PROSES');

  if (prosesItems.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding: 40px; color: #888;">Tidak ada antrian pesanan yang diproses.</div>';
    return;
  }

  container.innerHTML = prosesItems.map(t => `
    <div style="background:#fff; border:1px solid #c8e6c9; border-radius:12px; padding:16px; margin-bottom:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <span style="font-weight:700; color:#333;">${t.transId}</span>
        <span style="background:#e8f5e9; color:#2e7d32; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">PROSES</span>
      </div>
      <div style="font-size:13px; color:#333; margin-bottom:4px;">Pelanggan: <b>${t.customerName || 'Umum'}</b></div>
      <div style="font-size:12px; color:#666; margin-bottom:10px;">Metode: ${t.metode || 'CASH'}</div>
      
      <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:12px; font-size:13px;">
        ${t.items.map(i => `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span><b>${i.qty}x</b> ${i.nama}</span>
          <span style="font-size:11px; color:#777;">${i.notes !== 'Normal' ? `(${i.notes})` : ''}</span>
        </div>`).join('')}
      </div>

      <button onclick="finishOrder('${t.transId}')" style="width:100%; background:#2e7d32; color:#fff; border:none; padding:10px; border-radius:8px; font-weight:600; cursor:pointer;">
        ✓ Tandai Selesai
      </button>
    </div>
  `).join('');
}

// CUSTOM ALERT MODAL HELPERS
function showAlert(message, title = 'Informasi', type = 'info') {
  var modal = document.getElementById('custom-alert-modal');
  var titleElem = document.getElementById('alert-modal-title');
  var msgElem = document.getElementById('alert-modal-message');
  var iconContainer = document.getElementById('alert-icon-container');

  if (!modal || !titleElem || !msgElem || !iconContainer) {
    alert(title + ": " + message);
    return;
  }

  titleElem.innerText = title;
  msgElem.innerText = message;

  if (type === 'success') {
    iconContainer.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
  } else if (type === 'error') {
    iconContainer.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e53935" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else {
    iconContainer.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--primary-pink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }

  modal.classList.remove('hidden');
}

function closeCustomAlert() {
  document.getElementById('custom-alert-modal').classList.add('hidden');
}

function closeModal(id) { 
  document.getElementById(id).classList.add('hidden'); 
}

window.addEventListener('beforeunload', function (e) {
  if (currentCart && currentCart.length > 0) {
    e.preventDefault();
    e.returnValue = 'Masih ada transaksi di keranjang! Yakin ingin keluar?';
    return e.returnValue;
  }
});

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
