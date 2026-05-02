// ============================================================
//  CART.JS — logika koszyka
//  Zawiera: stan koszyka (cart, previousCartItemCount),
//  operacje na koszyku (add/remove/update quantity),
//  obliczanie rabatów + wysyłki, renderowanie koszyka,
//  formularz dostawy, obsługę płatności Przelewy24.
//
//  Zależności zewnętrzne:
//    • DOM: cartPanel, cartPanelOverlay, cartItemsContainer,
//           cartEmptyMessage, cartTotalPrice, cartCheckoutButton,
//           cartBadges, mobileCartButton, cartDiscountReminder,
//           cartSummaryModalOverlay, desktopCartContainer
//    • Selecty/inputy: shelfTypeSelect, heightSelect, widthSelect
//    • Funkcje: generateOrderCode(), computePriceDetailed(),
//               generate3dSnapshotFromCurrentModel()
//    • Zmienne Three.js: shelfGroup, currentAnimationTimeline
//    • Zmienne wzorów/cen: DISCOUNTS (z wzory.js/ceny.js)
//    • Custom flags: customShelfPositionEnabled
// ============================================================

// ---- KONFIGURACJA ----
const BACKEND_URL = 'https://polki-backend-production.up.railway.app';
const SHIPPING_PER_ITEM = 19; // Kurier DPD — 19 zł za każdą półkę

// ---- STAN KOSZYKA (globalny, używany też poza cart.js — np. przy
//      wyświetlaniu rabatu na stronie głównej) ----
let cart = [];
let previousCartItemCount = 0;
let modalScrollListener = null;

// ---- OPERACJE NA POZYCJACH KOSZYKA ----
function increaseQuantity(itemCode) {
    const item = cart.find(i => i.code === itemCode);
    if (item) { item.quantity++; }
    updateCartDisplay();
}

function decreaseQuantity(itemCode) {
    const item = cart.find(i => i.code === itemCode);
    if (item && item.quantity > 1) {
        item.quantity--;
    } else {
        cart = cart.filter(i => i.code !== itemCode);
    }
    updateCartDisplay();
}

function removeFromCart(itemCode) {
    cart = cart.filter(item => item.code !== itemCode);
    updateCartDisplay();
}

// ---- OBLICZANIE SUMY KOSZYKA + RABATÓW + WYSYŁKA ----
function calculateCartTotal() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let discount10 = 0;
    let discount25 = 0;
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (totalItems === 1) {
        const itemPrice = cart[0].price;
        discount10 = itemPrice * DISCOUNTS.discount1item;
    } else if (totalItems >= 2) {
        const allPrices = [];
        cart.forEach(item => {
            for (let i = 0; i < item.quantity; i++) { allPrices.push(item.price); }
        });
        allPrices.sort((a, b) => b - a);
        const maxPrice = allPrices[0];
        const minPrice = allPrices[allPrices.length - 1];
        discount10 = maxPrice * DISCOUNTS.discountBest;
        discount25 = minPrice * DISCOUNTS.discountCheap;
    }
    const totalDiscount = discount10 + discount25;
    const shipping = totalItems * SHIPPING_PER_ITEM;
    const total = subtotal - totalDiscount + shipping;
    return { subtotal, discount10, discount25, totalDiscount, shipping, total };
}

// ---- OTWIERANIE / ZAMYKANIE PANELU KOSZYKA ----
function openCart() {
    if (cartPanel && cartPanelOverlay) {
        cartPanel.classList.add('visible');
        cartPanelOverlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
}

function closeCart() {
    if (cartPanel && cartPanelOverlay) {
        cartPanel.classList.remove('visible');
        cartPanelOverlay.classList.remove('visible');
        document.body.style.overflow = '';
    }
}

// ---- DODAWANIE DO KOSZYKA (z animacją snapshotu 3D) ----
async function addToCart() {
    // Haptic feedback: "double tap" — dodawanie do koszyka to kluczowy moment, użytkownik czuje że "klik się stał"
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([10, 40, 18]); } catch(_) {}
    }
    const orderCode = generateOrderCode();
    const priceDetails = computePriceDetailed();
    if (!orderCode || !priceDetails) {
        alert("Proszę, dokończ konfigurację półki przed dodaniem jej do koszyka.");
        return;
    }
    const existingItem = cart.find(item => item.code === orderCode);
    if (existingItem) {
        increaseQuantity(existingItem.code);
        openCart();
        const itemElement = cartItemsContainer.querySelector(`[data-code="${existingItem.code}"]`);
        if (itemElement) {
            itemElement.classList.remove('section-highlight-flash');
            void itemElement.offsetWidth;
            itemElement.classList.add('section-highlight-flash');
        }
        return;
    }
    const activeAddToCartButton = document.getElementById('addToCartBtn');
    const originalButtonContent = activeAddToCartButton.innerHTML;
    activeAddToCartButton.innerHTML = `<svg class="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span>Generuję...</span>`;
    activeAddToCartButton.disabled = true;
    try {
        // FIX: poczekaj aż aktualna animacja 3D się skończy, żeby snapshot łapał finalny model
        if (currentAnimationTimeline && currentAnimationTimeline.isActive && currentAnimationTimeline.isActive()) {
            await new Promise(resolve => {
                const _tl = currentAnimationTimeline;
                _tl.eventCallback('onComplete', () => { setTimeout(resolve, 80); });
                // fallback w razie gdyby timeline już zakończył się zanim listener się podpiął
                setTimeout(resolve, 1500);
            });
        } else {
            // nawet bez animacji daj krótką chwilę na synchronizację renderera
            await new Promise(r => setTimeout(r, 50));
        }
        const snapshotDataUrl = await generate3dSnapshotFromCurrentModel();

        const isModular = shelfTypeSelect.value === 'modular';

        const newItem = {
            name: shelfTypeSelect.options[shelfTypeSelect.selectedIndex].text,
            summary: `${document.getElementById("widthSummary").textContent} x ${document.getElementById("heightSummary").textContent} x ${document.getElementById("depthSummary").textContent}`,
            shelfCountText: document.getElementById("shelfCountSummary").textContent,
            gapInfo: (function() {
                if (typeof customShelfPositionEnabled !== "undefined" && customShelfPositionEnabled) return "Własne rozmieszczenie";
                // Odczytaj rzeczywiste przerwy z aktualnego modelu 3D
                if (shelfGroup && shelfGroup.children.length > 0) {
                    const _t = 0.18;
                    const _shelves = shelfGroup.children.filter(c => c.isMesh && c.name && c.name.startsWith('internalShelf_')).sort((a,b) => a.position.y - b.position.y);
                    if (_shelves.length > 0) {
                        const _tp = shelfGroup.getObjectByName('topPanel');
                        const _bp = shelfGroup.getObjectByName('bottomPanel');
                        const _h = parseFloat(heightSelect.value) / 10;
                        const _botY = _bp ? _bp.position.y + _t/2 : -_h/2;
                        const _topY = _tp ? _tp.position.y - _t/2 : _h/2;
                        const _gaps = [];
                        _gaps.push(Math.round((_shelves[0].position.y - _t/2 - _botY) * 10 * 10) / 10);
                        for (let _i = 0; _i < _shelves.length - 1; _i++) {
                            _gaps.push(Math.round((_shelves[_i+1].position.y - _t/2 - (_shelves[_i].position.y + _t/2)) * 10 * 10) / 10);
                        }
                        _gaps.push(Math.round((_topY - (_shelves[_shelves.length-1].position.y + _t/2)) * 10 * 10) / 10);
                        const _allEqual = _gaps.every(g => Math.abs(g - _gaps[0]) < 0.2);
                        if (_allEqual) return `${_gaps[0]} cm`;
                        return _gaps.map(g => g + ' cm').join(' / ');
                    }
                }
                return document.getElementById("gapSummary").textContent;
            })(),
            sideColor: document.getElementById("sideColorSummary").textContent,
            shelfColor: document.getElementById("shelfColorSummary").textContent,
            extras: document.getElementById("extraOptionsSummary").textContent,
            price: priceDetails.total,
            code: orderCode,
            quantity: 1,
            snapshot: snapshotDataUrl,
        };

        // Animacja "lotu" półki do ikony koszyka
        const cartIcon = window.innerWidth >= 768 ? desktopCartContainer : document.getElementById('mobileCartButton');
        const startRect = activeAddToCartButton.getBoundingClientRect();
        const endRect = cartIcon.getBoundingClientRect();
        const flyingShelf = document.createElement('img');
        flyingShelf.src = snapshotDataUrl;
        flyingShelf.className = 'shelf-to-cart-animation';
        document.body.appendChild(flyingShelf);
        flyingShelf.style.left = `${startRect.left + startRect.width / 2 - 50}px`;
        flyingShelf.style.top = `${startRect.top + startRect.height / 2 - 50}px`;
        flyingShelf.style.width = `100px`;
        flyingShelf.style.height = `100px`;
        flyingShelf.getBoundingClientRect();
        flyingShelf.style.transform = `translate(${endRect.left - startRect.left}px, ${endRect.top - startRect.top}px) scale(0.2)`;
        flyingShelf.style.opacity = '0';
        cart.push(newItem);
        setTimeout(() => {
            if (document.body.contains(flyingShelf)) document.body.removeChild(flyingShelf);
            updateCartDisplay();
            openCart();
        }, 1000);
    } catch (e) {
        console.error("Nie udało się wygenerować miniatury przy dodawaniu do koszyka:", e);
        alert("Wystąpił błąd podczas generowania podglądu. Spróbuj ponownie.");
    } finally {
        activeAddToCartButton.innerHTML = originalButtonContent;
        activeAddToCartButton.disabled = false;
    }
}

// ---- ANIMACJA BŁYSKU PRZY UZYSKANIU RABATU ----
function triggerDiscountAnimation() {
    const subtotalPriceEl = document.getElementById('cartSubtotalPrice');
    const discountLineEl10 = document.getElementById('cartDiscountLine10');
    const discountLineEl25 = document.getElementById('cartDiscountLine25');
    const totalPriceLineEl = document.getElementById('cartTotalPriceLine');
    if (!subtotalPriceEl || !totalPriceLineEl || !discountLineEl10 || !discountLineEl25) return;
    subtotalPriceEl.classList.add('discount-subtotal-wobble');
    if (discountLineEl10.style.display === 'flex') discountLineEl10.classList.add('discount-line-pop');
    if (discountLineEl25.style.display === 'flex') discountLineEl25.classList.add('discount-line-pop');
    totalPriceLineEl.classList.add('discount-total-glow');
    setTimeout(() => {
        subtotalPriceEl.classList.remove('discount-subtotal-wobble');
        if (discountLineEl10) discountLineEl10.classList.remove('discount-line-pop');
        if (discountLineEl25) discountLineEl25.classList.remove('discount-line-pop');
        totalPriceLineEl.classList.remove('discount-total-glow');
    }, 2000);
}

// ---- MAPOWANIE NAZWY KOLORU → HEX ----
function getColorHex(label) {
    if (!label) return '#888';
    const l = label.toLowerCase();
    if (l.includes('ąb') || l.includes('ab') || l.includes('dąb')) return '#8B5A2B';
    if (l.includes('biał') || l.includes('bial') || l.includes('white')) return '#FFFFFF';
    if (l.includes('czarn') || l.includes('black')) return '#000000';
    return '#888888';
}

// ---- RENDEROWANIE PANELU KOSZYKA ----
function updateCartDisplay() {
    if (!cartItemsContainer || !cartBadges) return;
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const justGotDiscount = (totalItems === 1 && previousCartItemCount === 0) || (totalItems >= 2 && previousCartItemCount < 2);
    cartItemsContainer.innerHTML = '';
    if (cart.length === 0) {
        if (cartEmptyMessage) {
            cartEmptyMessage.style.display = 'block';
            cartItemsContainer.appendChild(cartEmptyMessage);
        }
    } else {
        if (cartEmptyMessage) cartEmptyMessage.style.display = 'none';
        cart.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'cart-item-card';
            itemElement.dataset.code = item.code;
            itemElement.innerHTML = `
            <div class="cart-item-thumb" data-snap="${item.snapshot||''}">
                ${item.snapshot ? `<img src="${item.snapshot}" alt="${item.name}">` : '<div style="font-size:10px;color:#d1d5db;text-align:center;padding:8px">brak</div>'}
            </div>
            <div class="cart-item-body">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                    <div class="cart-item-name">${item.name}</div>
                    <span class="cart-item-price">${(item.price * item.quantity).toFixed(2).replace('.',',')} zł</span>
                </div>
                <div class="cart-item-specs">
                    <span class="cart-item-spec-label">Wymiary</span>
                    <span class="cart-item-spec-val">${item.summary}</span>
                    <span class="cart-item-spec-label">Półki</span>
                    <span class="cart-item-spec-val">${item.shelfCountText||'—'}</span>
                    <span class="cart-item-spec-label">Boki</span>
                    <span class="cart-item-spec-val"><span class="cart-item-color-dot" style="background:${getColorHex(item.sideColor)}"></span>${item.sideColor}</span>
                    <span class="cart-item-spec-label">Półki kol.</span>
                    <span class="cart-item-spec-val"><span class="cart-item-color-dot" style="background:${getColorHex(item.shelfColor)}"></span>${item.shelfColor}</span>
                </div>
                <div class="cart-item-bottom">
                    <div class="cart-item-actions">
                        <div class="cart-item-qty">
                            <button onclick="decreaseQuantity('${item.code}')">−</button>
                            <span>${item.quantity}</span>
                            <button onclick="increaseQuantity('${item.code}')">+</button>
                        </div>
                        <button class="cart-item-remove" onclick="removeFromCart('${item.code}')" title="Usuń">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
            cartItemsContainer.appendChild(itemElement);
        });
    }
    // --- wariant UI z tagami rabatów (cartVariantC) ---
    const totals = calculateCartTotal();
    const variantC = document.getElementById('cartVariantC');
    const cartDiscountTags = document.getElementById('cartDiscountTags');
    const cartSavingsLine = document.getElementById('cartSavingsLine');
    const cartUpsellHint = document.getElementById('cartUpsellHint');
    if (variantC) {
        if (totalItems > 0) {
            variantC.style.display = 'block';
            const subtotalEl = document.getElementById('cartSubtotalPrice');
            if (subtotalEl) {
                subtotalEl.textContent = totals.totalDiscount > 0 ? totals.subtotal.toFixed(2).replace('.',',') + ' zł' : '';
                if (totals.totalDiscount > 0) {
                    subtotalEl.classList.add('discount-subtotal-slash');
                } else {
                    subtotalEl.classList.remove('discount-subtotal-slash');
                }
            }
            if (cartDiscountTags) {
                cartDiscountTags.innerHTML = '';
                if (totals.discount10 > 0) {
                    cartDiscountTags.innerHTML += `<span style="background:#f0fdf4;border:0.5px solid #bbf7d0;border-radius:99px;font-size:9px;font-weight:700;color:#15803d;padding:2px 7px;">-10% półka 1.</span>`;
                }
                if (totals.discount25 > 0) {
                    cartDiscountTags.innerHTML += `<span style="background:#f0fdf4;border:0.5px solid #bbf7d0;border-radius:99px;font-size:9px;font-weight:700;color:#15803d;padding:2px 7px;">-25% półka 2.</span>`;
                }
            }
            if (cartSavingsLine) {
                if (totals.totalDiscount > 0) {
                    cartSavingsLine.textContent = 'oszczędzasz ' + totals.totalDiscount.toFixed(2).replace('.',',') + ' zł';
                    cartSavingsLine.style.display = 'block';
                } else {
                    cartSavingsLine.style.display = 'none';
                }
            }
            if (cartUpsellHint) {
                cartUpsellHint.style.display = (totalItems === 1 && totals.discount25 === 0) ? 'flex' : 'none';
            }
        } else {
            variantC.style.display = 'none';
        }
    }
    if (justGotDiscount) { triggerDiscountAnimation(); }
    cartTotalPrice.textContent = `${totals.total.toFixed(2).replace('.',',')} zł`;
    cartBadges.forEach(badge => {
        badge.textContent = totalItems;
        badge.style.display = totalItems > 0 ? 'flex' : 'none';
    });
    if (mobileCartButton) {
        const mobileCartPriceSpan = mobileCartButton.querySelector('.mobile-cart-price');
        if (mobileCartPriceSpan) {
            mobileCartPriceSpan.textContent = totalItems > 0 ? `${totals.total.toFixed(2)} zł` : 'Koszyk';
        }
    }
    // Pokaż cenę z wysyłką w panelu koszyka
    const shippingNote = document.getElementById('cartShippingNote');
    if (shippingNote) {
        if (totalItems > 0) {
            shippingNote.textContent = `+ ${(totalItems * SHIPPING_PER_ITEM).toFixed(0)} zł wysyłka DPD`;
            shippingNote.style.display = 'block';
        } else {
            shippingNote.style.display = 'none';
        }
    }
    cartCheckoutButton.disabled = cart.length === 0;
    previousCartItemCount = totalItems;
}

// ---- PRZEŁĄCZANIE SEKCJI FAKTURY ----
function toggleInvoiceSection() {
    const fields = document.getElementById('invoiceFields');
    const indicator = document.getElementById('invoiceToggleIndicator');
    const knob = document.getElementById('invoiceToggleKnob');
    const hint = document.getElementById('invoiceToggleHint');
    const isOpen = fields.style.display !== 'none';
    if (isOpen) {
        fields.style.display = 'none';
        indicator.style.background = '#e5e7eb';
        knob.style.transform = 'translateX(0)';
        hint.textContent = 'Kliknij, aby wypełnić dane firmy';
    } else {
        fields.style.display = 'block';
        indicator.style.background = '#16a34a';
        knob.style.transform = 'translateX(17px)';
        hint.textContent = 'Wypełnij dane firmy poniżej';
    }
}

// ---- OTWARCIE MODALA PODSUMOWANIA (handleCheckout) ----
function handleCheckout() {
    if (cart.length === 0) return;
    // Haptic feedback: długi "boom" — moment decyzji zakupowej, satysfakcjonujący sygnał
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([25, 30, 40]); } catch(_) {}
    }
    closeCart();
    const totals = calculateCartTotal();
    const allCodes = cart.flatMap(item => Array(item.quantity).fill(item.code)).join('\n');

    // Wypełnij listę produktów w modalu
    const cartSummaryItemsContainer = document.getElementById('cartSummaryItemsContainer');
    cartSummaryItemsContainer.innerHTML = '';
    cart.forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'cart-item-card';
        itemCard.innerHTML = `
            <div class="cart-item-thumb" data-snap="${item.snapshot||''}">
                ${item.snapshot ? `<img src="${item.snapshot}" alt="${item.name}">` : '<div style="font-size:10px;color:#d1d5db;text-align:center;padding:8px">brak</div>'}
            </div>
            <div class="cart-item-body">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
                    <div class="cart-item-name">${item.name}</div>
                    <span style="font-size:14px;font-weight:800;color:#16a34a;flex-shrink:0;margin-left:6px">${(item.price * item.quantity).toFixed(2).replace('.',',')} zł</span>
                </div>
                <div class="cart-item-specs">
                    <span class="cart-item-spec-label">Wymiary</span>
                    <span class="cart-item-spec-val">${item.summary}</span>
                    <span class="cart-item-spec-label">Półki</span>
                    <span class="cart-item-spec-val">${item.shelfCountText||'—'}</span>
                    <span class="cart-item-spec-label">Boki</span>
                    <span class="cart-item-spec-val"><span class="cart-item-color-dot" style="background:${getColorHex(item.sideColor)}"></span>${item.sideColor}</span>
                    <span class="cart-item-spec-label">Półki kol.</span>
                    <span class="cart-item-spec-val"><span class="cart-item-color-dot" style="background:${getColorHex(item.shelfColor)}"></span>${item.shelfColor}</span>
                    ${item.extras && item.extras !== 'standardowa' ? `<span class="cart-item-spec-label">Opcje</span><span class="cart-item-spec-val">${item.extras}</span>` : ''}
                </div>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px">Ilość: ${item.quantity}</div>
            </div>
        `;
        cartSummaryItemsContainer.appendChild(itemCard);
    });

    // Podsumowanie cen
    const cartSummarySubtotalLine = document.getElementById('cartSummarySubtotalLine');
    const cartSummarySubtotalPrice = document.getElementById('cartSummarySubtotalPrice');
    const cartSummaryCombinedDiscountLine = document.getElementById('cartSummaryCombinedDiscountLine');
    const cartSummaryCombinedDiscountAmount = document.getElementById('cartSummaryCombinedDiscountAmount');
    const cartSummaryShippingLine = document.getElementById('cartSummaryShippingLine');
    const cartSummaryShippingPrice = document.getElementById('cartSummaryShippingPrice');
    const cartSummaryTotalPrice = document.getElementById('cartSummaryTotalPrice');

    if (totals.totalDiscount > 0) {
        if (cartSummarySubtotalLine) cartSummarySubtotalLine.style.display = 'flex';
        if (cartSummarySubtotalPrice) cartSummarySubtotalPrice.textContent = `${totals.subtotal.toFixed(2).replace('.',',')} zł`;
        if (cartSummaryCombinedDiscountLine) cartSummaryCombinedDiscountLine.style.display = 'flex';
        if (cartSummaryCombinedDiscountAmount) cartSummaryCombinedDiscountAmount.textContent = `−${totals.totalDiscount.toFixed(2).replace('.',',')} zł`;
    } else {
        if (cartSummarySubtotalLine) cartSummarySubtotalLine.style.display = 'none';
        if (cartSummaryCombinedDiscountLine) cartSummaryCombinedDiscountLine.style.display = 'none';
    }
    if (cartSummaryShippingLine) cartSummaryShippingLine.style.display = 'flex';
    if (cartSummaryShippingPrice) cartSummaryShippingPrice.textContent = `${totals.shipping.toFixed(2)} zł`;
    if (cartSummaryTotalPrice) cartSummaryTotalPrice.textContent = `${totals.total.toFixed(2)} zł`;

    // Zapisz kody konfiguracji (ukryte)
    const codesInput = document.getElementById('cartSummaryAllCodes');
    if (codesInput) codesInput.value = allCodes;

    // Resetuj formularz i komunikaty
    ['orderFirstName','orderLastName','orderEmail','orderPhone','orderStreet','orderPostCode','orderCity','orderNotes',
     'invoiceCompany','invoiceNip','invoicePostCode','invoiceAddress'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const errEl = document.getElementById('orderFormError');
    const successEl = document.getElementById('orderSuccessMsg');
    const formFields = document.getElementById('orderFormFields');
    if (errEl) errEl.classList.add('hidden');
    if (successEl) { successEl.classList.add('hidden'); successEl.innerHTML = ''; }
    if (formFields) { formFields.style.opacity = ''; formFields.style.pointerEvents = ''; }
    // Zamknij sekcję faktury
    const invoiceFields = document.getElementById('invoiceFields');
    const invoiceIndicator = document.getElementById('invoiceToggleIndicator');
    const invoiceKnob = document.getElementById('invoiceToggleKnob');
    const invoiceHint = document.getElementById('invoiceToggleHint');
    if (invoiceFields) invoiceFields.style.display = 'none';
    if (invoiceIndicator) invoiceIndicator.style.background = '#e5e7eb';
    if (invoiceKnob) invoiceKnob.style.transform = 'translateX(0)';
    if (invoiceHint) invoiceHint.textContent = 'Kliknij, aby wypełnić dane firmy';

    // Resetuj przycisk Złóż zamówienie
    const submitBtn = document.getElementById('submitOrderBtn');
    const submitLabel = document.getElementById('submitOrderBtnLabel');
    if (submitBtn) submitBtn.disabled = false;
    if (submitLabel) submitLabel.textContent = 'Złóż zamówienie i zapłać';

    // Otwórz modal
    const cartSummaryModalOverlay = document.getElementById('cartSummaryModalOverlay');
    if (cartSummaryModalOverlay) cartSummaryModalOverlay.classList.add('visible');
    document.body.classList.add('no-scroll');
}

// ---- ZAMKNIĘCIE MODALA PODSUMOWANIA ----
function closeCartSummaryModal() {
    const cartSummaryModalOverlay = document.getElementById('cartSummaryModalOverlay');
    if (cartSummaryModalOverlay) {
        cartSummaryModalOverlay.classList.remove('visible');
        document.body.classList.remove('no-scroll');
    }
}

// ---- WYSYŁKA ZAMÓWIENIA DO BACKENDU (PayNow) ----
async function submitOrder() {
    const firstName = document.getElementById('orderFirstName')?.value.trim();
    const lastName  = document.getElementById('orderLastName')?.value.trim();
    const email     = document.getElementById('orderEmail')?.value.trim();
    const phone     = document.getElementById('orderPhone')?.value.trim();
    const street    = document.getElementById('orderStreet')?.value.trim();
    const postCode  = document.getElementById('orderPostCode')?.value.trim();
    const city      = document.getElementById('orderCity')?.value.trim();
    const notes     = document.getElementById('orderNotes')?.value.trim() || '';
    const errEl     = document.getElementById('orderFormError');
    const successEl = document.getElementById('orderSuccessMsg');
    const submitBtn = document.getElementById('submitOrderBtn');
    const submitLabel = document.getElementById('submitOrderBtnLabel');

    // Walidacja
    const missing = [];
    if (!firstName) missing.push('Imię');
    if (!lastName)  missing.push('Nazwisko');
    if (!email || !email.includes('@')) missing.push('E-mail (poprawny)');
    if (!phone)     missing.push('Telefon');
    if (!street)    missing.push('Ulica');
    if (!postCode)  missing.push('Kod pocztowy');
    if (!city)      missing.push('Miasto');

    const invoiceFieldsEl = document.getElementById('invoiceFields');
    const wantInvoice = invoiceFieldsEl && invoiceFieldsEl.style.display !== 'none';
    if (wantInvoice) {
        if (!document.getElementById('invoiceCompany')?.value.trim())  missing.push('Nazwa firmy');
        if (!document.getElementById('invoiceNip')?.value.trim())      missing.push('NIP');
        if (!document.getElementById('invoicePostCode')?.value.trim()) missing.push('Kod pocztowy firmy');
        if (!document.getElementById('invoiceAddress')?.value.trim())  missing.push('Adres firmy');
    }

    if (missing.length > 0) {
        if (errEl) {
            errEl.textContent = 'Uzupełnij wymagane pola: ' + missing.join(', ');
            errEl.classList.remove('hidden');
            errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
    }
    if (errEl) errEl.classList.add('hidden');

    // Dane koszyka
    const totals = calculateCartTotal();
    const orderCode = document.getElementById('cartSummaryAllCodes')?.value || '';

    // Zablokuj przycisk
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.innerHTML = `<svg style="width:16px;height:16px;animation:spin 1s linear infinite;vertical-align:middle" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="3"/><path d="M12 2a10 10 0 0110 10" stroke="white" stroke-width="3" stroke-linecap="round"/></svg> Przekierowuję do płatności...`;

    try {
        const amountGr = Math.round(totals.total * 100); // w groszach

        const orderData = {
            firstName, lastName, email, phone,
            street, postCode, city, notes,
            orderCode,
            wantInvoice,
            invCompany:  wantInvoice ? (document.getElementById('invoiceCompany')?.value.trim()  || '') : '',
            invNip:      wantInvoice ? (document.getElementById('invoiceNip')?.value.trim()       || '') : '',
            invPostCode: wantInvoice ? (document.getElementById('invoicePostCode')?.value.trim()  || '') : '',
            invAddr:     wantInvoice ? (document.getElementById('invoiceAddress')?.value.trim()   || '') : '',
            shipping:    totals.shipping,
            discount:    totals.totalDiscount || 0,
            cart: cart.map(item => ({
                name:      item.name,
                code:      item.code,
                quantity:  item.quantity,
                price:     item.price,
                summary:   item.summary || '',
                sideColor: item.sideColor || '',
                shelfColor: item.shelfColor || '',
                snapshot:  item.snapshot || ''
            }))
        };

        const response = await fetch(BACKEND_URL + '/api/paynow-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountGr, orderData })
        });
        const result = await response.json();

        if (result.redirectUrl) {
            if (successEl) {
                successEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;color:#15803d;font-weight:600;font-size:.9rem;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/></svg>
                    Formularz zapisany! Przekierowuję do bezpiecznej płatności...
                </div>`;
                successEl.classList.remove('hidden');
            }
            const formFields = document.getElementById('orderFormFields');
            if (formFields) { formFields.style.opacity = '0.4'; formFields.style.pointerEvents = 'none'; }
            setTimeout(() => { window.location.href = result.redirectUrl; }, 1200);
        } else {
            throw new Error(result.error || 'Nie można uruchomić płatności');
        }
    } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = 'Złóż zamówienie i zapłać';
        if (errEl) {
            errEl.textContent = 'Błąd: ' + err.message + '. Spróbuj ponownie lub skontaktuj się z nami.';
            errEl.classList.remove('hidden');
        }
        console.error('Błąd składania zamówienia:', err);
    }
}

// ---- PODPIĘCIE PRZYCISKU SUBMIT (wywoływane po DOMContentLoaded z configurator.js) ----
function initSubmitOrderBtn() {
    const submitOrderBtn = document.getElementById('submitOrderBtn');
    if (submitOrderBtn) {
        submitOrderBtn.addEventListener('click', submitOrder);
    }
    const overlay = document.getElementById('cartSummaryModalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCartSummaryModal(); });
    }
}
