var API_URL = "https://script.google.com/macros/s/AKfycbwHA9QpcBwA-4vtFANUYDkUp_rJIxw0NilgbmxqSmgrTJWasiJ5_O_aGCT20QCnki1BjA/exec";

var productsData = [];
var membersData = [];

var currentUser = null;
var currentCart = [];
var cart = currentCart;
var selectedCustomerType = 'REGULAR';
var selectedMemberId = null;

var modalTriggerSource = null; 
var activeCartIndex = null;
var activeProductId = null;
var holdCustomQty = 1;
var selectedIce = "Normal Ice";
var selectedSugar = "Normal Sugar";

var holdTimer = null;
var isLongPress = false;

document.addEventListener("DOMContentLoaded", function() {
  checkExistingSession();
  loadDataFromSheet();
});

function loadDataFromSheet() {
  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'getInitialData' })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success && res.data) {
      productsData = res.data.products || [];
      membersData = res.data.members || [];
      renderCatalog();
    }
  })
  .catch(err => console.error("Gagal memuat data dari Sheet:", err));
}

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
    } else { alert(res.message); }
  });
}

function setActiveHeaderTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if(tabId) document.getElementById(tabId).classList.add('active');
}

function showDashboard() {
  setActiveHeaderTab('tab-home');
  document.getElementById('home-dashboard-view').classList.remove('hidden');
  document.getElementById('new-order-view').classList.add('hidden');
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
      alert('Silakan masukkan nama pelanggan terlebih dahulu!');
      document.getElementById('cust-name').focus();
      return;
    }
  } else {
    nameVal = document.getElementById('member-search-input').value.trim();
    if (!nameVal || !selectedMemberId) {
      alert('Silakan pilih member terdaftar dari daftar pencarian!');
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
    document.getElementById('home-dashboard-view').classList.add('hidden');
    document.getElementById('new-order-view').classList.remove('hidden');

    document.getElementById('cart-customer-name').innerText = getActiveCustomerName();
    
    var searchInp = document.getElementById('menu-search-input');
    if (searchInp) searchInp.value = '';

    clearCart();
  }, 400);
}

function openDummyMenu(title) {
  if (title === 'Kantung Pending') setActiveHeaderTab('tab-pending');
  else if (title === 'Antrian Bar / Dapur') setActiveHeaderTab('tab-kitchen');
  alert('Fitur "' + title + '" siap diintegrasikan dengan database backend.');
}

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
  alert(`Member baru "${name}" berhasil didaftarkan!`);
}

document.addEventListener('click', function(e) {
  var container = document.getElementById('select-member-container');
  if (container && !container.contains(e.target)) {
    var dropdown = document.getElementById('member-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
});

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

function startHold(productId) {
  isLongPress = false;
  holdTimer = setTimeout(function() {
    isLongPress = true;
    openHoldCustomModal(productId);
  }, 500);
}

function endHold(productId) {
  clearTimeout(holdTimer);
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
  var btnRed = document.getElementById('btnRed');

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
    return `
      <div class="cart-item">
        <div class="cart-item-left">
          <span class="cart-item-title">${item.nama}</span>
          ${item.notes !== "Normal" ? `
            <div class="cart-item-notes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>${item.notes}</span>
            </div>
          ` : ''}
          <button onclick="openCartCustomModal(${idx})" class="btn-custom">
            ⚙️ Custom
          </button>
        </div>

        <div class="cart-item-right">
          <div class="qty-control">
            <button class="btn-qty" onclick="updateQty(${idx}, -1)">-</button>
            <span class="qty-num">${item.qty}</span>
            <button class="btn-qty" onclick="updateQty(${idx}, 1)">+</button>
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
  currentCart[index].qty += delta;
  if (currentCart[index].qty <= 0) currentCart.splice(index, 1);
  updateCartUI();
}

function clearCart() { currentCart = []; updateCartUI(); }

function getActiveCustomerName() {
  if (selectedCustomerType === 'REGULAR') {
    return document.getElementById('cust-name').value.trim() || 'Umum';
  } else {
    return document.getElementById('member-search-input').value.trim() || 'Member';
  }
}

function savePendingOrder() {
  if (currentCart.length === 0) return alert('Keranjang masih kosong!');
  var custName = getActiveCustomerName();

  var pendingData = { id: 'PEND-' + Date.now(), customerName: custName, cart: currentCart, time: new Date().toLocaleTimeString() };
  var pendingList = JSON.parse(localStorage.getItem('qiski_pending') || '[]');
  pendingList.push(pendingData);
  localStorage.setItem('qiski_pending', JSON.stringify(pendingList));

  alert('Order a/n "' + custName + '" disimpan di Pending!');
  showDashboard();
}

function openPaymentModal() {
  if (currentCart.length === 0) return alert('Keranjang kosong!');
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  document.getElementById('pay-total-akhir').value = 'Rp ' + subtotal.toLocaleString('id-ID');
  document.getElementById('pay-cash-paid').value = '';
  document.getElementById('pay-change').value = 'Rp 0';
  document.getElementById('payment-modal').classList.remove('hidden');
}

function togglePayMethod() {
  var method = document.getElementById('pay-method').value;
  if (method === 'QRIS') document.getElementById('cash-group').classList.add('hidden');
  else document.getElementById('cash-group').classList.remove('hidden');
}

function calculatePayment() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var method = document.getElementById('pay-method').value;
  if (method === 'CASH') {
    var cashPaid = Number(document.getElementById('pay-cash-paid').value) || 0;
    var change = cashPaid - subtotal;
    document.getElementById('pay-change').value = change >= 0 ? 'Rp ' + change.toLocaleString('id-ID') : 'Uang Kurang!';
  }
}

function submitTransaction() {
  var subtotal = currentCart.reduce((a, b) => a + (b.harga * b.qty), 0);
  var method = document.getElementById('pay-method').value;
  var cashPaid = method === 'CASH' ? Number(document.getElementById('pay-cash-paid').value) || 0 : subtotal;
  var custName = getActiveCustomerName();

  if (method === 'CASH' && cashPaid < subtotal) return alert('Uang pembayaran masih kurang!');

  var payload = {
    kasirId: currentUser ? currentUser.id : 'KASIR-01', customerName: custName, subtotal: subtotal, totalAkhir: subtotal,
    metode: method, cashPaid: cashPaid, items: currentCart
  };

  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'saveTransaction', payload: payload })
  })
  .then(res => res.json())
  .then(res => {
    if (res.success) {
      alert('Transaksi a/n ' + custName + ' Berhasil!');
      closeModal('payment-modal');
      showDashboard();
    } else { alert('Gagal simpan: ' + res.message); }
  });
}

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function logout() { localStorage.removeItem('qiski_session'); location.reload(); }
