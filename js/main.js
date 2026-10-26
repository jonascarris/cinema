/* ==========================================================================
   CINEMA DANIEL E A FORNALHA ARDENTE - JAVASCRIPT PRINCIPAL
   Integração Mercado Pago, Seleção de Ingressos & Modais
   ========================================================================== */

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : '/api';

const TICKET_PRICE = 27.00;

let ticketCount = 1;
let kidsCount = 0;

document.addEventListener('DOMContentLoaded', () => {
  initSteppers();
  initModal();
  initFormMasks();
  initCheckoutSubmit();
  updateDisplay();
});

// Steppers de Ingressos e Crianças
function initSteppers() {
  const btnMinus = document.getElementById('btn-minus');
  const btnPlus = document.getElementById('btn-plus');
  const btnKidsMinus = document.getElementById('btn-kids-minus');
  const btnKidsPlus = document.getElementById('btn-kids-plus');

  if (btnMinus) {
    btnMinus.addEventListener('click', () => {
      if (ticketCount > 1) {
        ticketCount--;
        updateDisplay();
      }
    });
  }

  if (btnPlus) {
    btnPlus.addEventListener('click', () => {
      if (ticketCount < 30) {
        ticketCount++;
        updateDisplay();
      }
    });
  }

  if (btnKidsMinus) {
    btnKidsMinus.addEventListener('click', () => {
      if (kidsCount > 0) {
        kidsCount--;
        updateDisplay();
      }
    });
  }

  if (btnKidsPlus) {
    btnKidsPlus.addEventListener('click', () => {
      if (kidsCount < 10) {
        kidsCount++;
        updateDisplay();
      }
    });
  }
}

function updateDisplay() {
  const elTicketQty = document.getElementById('ticket-qty');
  const elKidsQty = document.getElementById('kids-qty');
  const elTotalPrice = document.getElementById('display-total-price');
  
  const modalSummaryTickets = document.getElementById('modal-summary-tickets');
  const modalSummaryKids = document.getElementById('modal-summary-kids');
  const modalSummaryTotal = document.getElementById('modal-summary-total');

  const total = ticketCount * TICKET_PRICE;
  const formattedTotal = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (elTicketQty) elTicketQty.textContent = ticketCount;
  if (elKidsQty) elKidsQty.textContent = kidsCount;
  if (elTotalPrice) elTotalPrice.textContent = formattedTotal;

  if (modalSummaryTickets) {
    modalSummaryTickets.textContent = `${ticketCount}x Ingresso${ticketCount > 1 ? 's' : ''} Inteira (R$ 27,00)`;
  }
  if (modalSummaryKids) {
    modalSummaryKids.textContent = `${kidsCount} criança${kidsCount === 1 ? '' : 's'} até 3 anos (isentas no colo)`;
  }
  if (modalSummaryTotal) {
    modalSummaryTotal.textContent = formattedTotal;
  }
}

// Controle do Modal
function initModal() {
  const btnOpen = document.getElementById('btn-open-checkout');
  const modal = document.getElementById('checkout-modal');
  const btnClose = document.getElementById('btn-close-modal');

  const pixModal = document.getElementById('pix-direct-modal');
  const btnClosePix = document.getElementById('btn-close-pix-modal');

  if (btnOpen && modal) {
    btnOpen.addEventListener('click', () => {
      modal.classList.add('active');
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  if (btnClosePix && pixModal) {
    btnClosePix.addEventListener('click', () => {
      pixModal.classList.remove('active');
    });
  }

  // Fechar ao clicar fora
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
    if (e.target === pixModal) pixModal.classList.remove('active');
  });
}

// Máscaras de CPF e Telefone
function initFormMasks() {
  const cpfInput = document.getElementById('cust-cpf');
  const phoneInput = document.getElementById('cust-phone');

  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 11) val = val.slice(0, 11);
      if (val.length > 9) {
        val = val.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
      } else if (val.length > 6) {
        val = val.replace(/^(\d{3})(\d{3})(\d{1,3})$/, '$1.$2.$3');
      } else if (val.length > 3) {
        val = val.replace(/^(\d{3})(\d{1,3})$/, '$1.$2');
      }
      e.target.value = val;
    });
  }

  if (phoneInput) {
    phoneInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 11) val = val.slice(0, 11);
      if (val.length > 10) {
        val = val.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
      } else if (val.length > 6) {
        val = val.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
      } else if (val.length > 2) {
        val = val.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
      }
      e.target.value = val;
    });
  }
}

// Envio do Formulário de Checkout
function initCheckoutSubmit() {
  const form = document.getElementById('checkout-form');
  const btnSubmit = document.getElementById('btn-submit-payment');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('cust-name').value.trim();
    const email = document.getElementById('cust-email').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const cpf = document.getElementById('cust-cpf').value.trim();
    const paymentMethodEl = document.querySelector('input[name="payment_method"]:checked');
    const paymentType = paymentMethodEl ? paymentMethodEl.value : 'preference';

    if (!name || !email || !phone || !cpf) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
        Gerando Ingresso no Mercado Pago...
      `;
    }

    const payload = {
      customer_name: name,
      email: email,
      phone: phone,
      cpf: cpf,
      quantity: ticketCount,
      children_under_3: kidsCount,
      payment_type: paymentType
    };

    try {
      const res = await fetch(`${API_BASE_URL}/checkout/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar e Pagar Agora';
      }

      if (!res.ok || !data.success) {
        alert(data.error || 'Não foi possível gerar a cobrança. Tente novamente.');
        return;
      }

      // Se for Checkout Pro, redireciona para a tela oficial do Mercado Pago
      if (data.mode === 'checkout_pro' && data.init_point) {
        window.location.href = data.init_point;
        return;
      }

      // Se for Pix direto na tela
      if (data.mode === 'pix_direct' && data.qr_code_pix) {
        const checkoutModal = document.getElementById('checkout-modal');
        const pixModal = document.getElementById('pix-direct-modal');
        const pixImg = document.getElementById('pix-qr-img');
        const pixCopia = document.getElementById('pix-copia-cola');
        const pixAmount = document.getElementById('pix-modal-amount');
        const btnTicket = document.getElementById('btn-view-ticket-pix');

        if (checkoutModal) checkoutModal.classList.remove('active');
        if (pixAmount) pixAmount.textContent = (data.total_amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        if (pixCopia) pixCopia.value = data.qr_code_pix;

        if (pixImg) {
          if (data.qr_code_base64) {
            pixImg.src = `data:image/png;base64,${data.qr_code_base64}`;
          } else {
            pixImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.qr_code_pix)}`;
          }
        }

        if (btnTicket) {
          btnTicket.href = `./ingresso.html?id=${data.order_id}`;
        }

        const copyBtn = document.getElementById('btn-copy-pix');
        if (copyBtn) {
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(data.qr_code_pix).then(() => {
              copyBtn.textContent = 'Copiado!';
              setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 2000);
            });
          };
        }

        if (pixModal) pixModal.classList.add('active');
        return;
      }

      // Fallback: vai direto para o voucher / ingresso
      window.location.href = `./ingresso.html?id=${data.order_id}`;

    } catch (err) {
      console.error('Erro na requisição de pagamento:', err);
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar e Pagar Agora';
      }
      alert('Erro de conexão ao comunicar com o servidor de pagamento.');
    }
  });
}
