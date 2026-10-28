import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve arquivos estáticos da raiz do projeto quando executado via Node standalone
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 5000;

// Credenciais Mercado Pago herdadas de praCamilaMiguel
const OFFICIAL_MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
const OFFICIAL_MP_PUBLIC_KEY = process.env.MERCADO_PAGO_PUBLIC_KEY || '';

// Preço e Informações do Filme
const TICKET_PRICE = 27.00;
const MOVIE_TITLE = 'Daniel e a Fornalha Ardente';
const SESSION_DATETIME = '02/11 às 19h';
const SESSION_RECOMMENDATION = 'Chegar com 30 minutos de antecedência (às 18h30)';
const THEATER_NAME = 'Cinesystem - Américas Shopping';
const THEATER_ADDRESS = 'Av. das Américas, 15.500 - Recreio dos Bandeirantes, Rio de Janeiro - RJ, CEP: 22790-702';

// Inicializa Supabase (opcional / caso o banco esteja ativo)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Armazenamento em memória (para a sessão/instância ativa)
const memoryOrders = new Map();
const checkinStatusMap = new Map();

// Helper para gerar código amigável de ingresso
function generateFriendlyCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'DAN-';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// -------------------------------------------------------------
// 1. HEALTH CHECK & CONFIGURAÇÕES PÚBLICAS
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    movie: MOVIE_TITLE,
    session: SESSION_DATETIME,
    recommendation: SESSION_RECOMMENDATION,
    theater: THEATER_NAME,
    address: THEATER_ADDRESS,
    ticket_price: TICKET_PRICE,
    rules: {
      children_under_3_free: true,
      children_description: 'Crianças até 3 anos não pagam (sentam no colo). Acima de 3 anos pagam valor integral (R$ 27,00).'
    },
    mercado_pago_ready: !!OFFICIAL_MP_TOKEN,
    supabase_ready: !!supabase
  });
});

// -------------------------------------------------------------
// 2. CHECKOUT & CRIAÇÃO DE PAGAMENTO MERCADO PAGO
// -------------------------------------------------------------
app.post('/api/checkout/create-payment', async (req, res) => {
  try {
    const {
      customer_name,
      email,
      phone,
      cpf,
      quantity = 1,
      children_under_3 = 0,
      payment_type = 'preference' // 'preference' (Checkout Pro) ou 'pix' (QR Code direto)
    } = req.body;

    if (!customer_name || !email || !phone || !cpf) {
      return res.status(400).json({ error: 'Nome, E-mail, Telefone e CPF são obrigatórios para emissão do ingresso.' });
    }

    const qty = Math.max(1, parseInt(quantity, 10));
    const kids = Math.max(0, parseInt(children_under_3, 10) || 0);
    const totalAmount = Number((qty * TICKET_PRICE).toFixed(2));
    const orderId = crypto.randomUUID();
    const ticketCode = generateFriendlyCode();

    const cleanCpf = cpf.replace(/\D/g, '');
    const cleanPhone = phone.replace(/\D/g, '');
    const phoneArea = cleanPhone.substring(0, 2) || '21';
    const phoneNumber = cleanPhone.substring(2) || '999999999';

    const orderPayload = {
      id: orderId,
      ticket_code: ticketCode,
      customer_name: customer_name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      cpf: cleanCpf,
      movie_title: MOVIE_TITLE,
      session_datetime: SESSION_DATETIME,
      theater_name: THEATER_NAME,
      theater_address: THEATER_ADDRESS,
      quantity: qty,
      children_under_3: kids,
      items_price: totalAmount,
      total_amount: totalAmount,
      mp_status: 'pending',
      payment_method: payment_type === 'pix' ? 'pix' : 'mercadopago_checkout',
      checkin_done: false,
      created_at: new Date().toISOString()
    };

    // Salva em memória como fallback rápido
    memoryOrders.set(orderId, orderPayload);

    // Tenta persistir no Supabase caso esteja configurado e ativo
    if (supabase) {
      try {
        const dbPayload = {
          id: orderId,
          customer_name: orderPayload.customer_name,
          email: orderPayload.email,
          phone: orderPayload.phone,
          cpf: orderPayload.cpf,
          items_price: totalAmount,
          total_amount: totalAmount,
          shipping_service_name: `Ingresso Cinema: ${qty}x Inteira (${kids > 0 ? kids + ' criança(s) colo' : 'sem crianças'}) - Código: ${ticketCode}`,
          shipping_price: 0,
          payment_method: orderPayload.payment_method,
          mp_status: 'pending',
          complement: `FILME: ${MOVIE_TITLE} | SESSÃO: ${SESSION_DATETIME} | CINE: ${THEATER_NAME} | INGRESSOS: ${qty} | CRIANÇAS ATE 3 ANOS: ${kids} | CODIGO: ${ticketCode}`
        };

        const { error: sbError } = await supabase.from('orders').insert([dbPayload]);
        if (sbError) {
          console.warn('[Supabase Warning] Não foi possível salvar em orders:', sbError.message);
        }
      } catch (sbErr) {
        console.warn('[Supabase Error]:', sbErr.message);
      }
    }

    const host = req.get('host') || 'cinema.atitudelaranja.com';
    const protocol = req.protocol === 'https' || host.includes('vercel.app') || host.includes('atitudelaranja.com') ? 'https' : 'http';
    const baseUrl = process.env.PUBLIC_URL || `${protocol}://${host}`;

    // SE O USUÁRIO OPTAR POR PIX DIRETO TRANSPARENTE
    if (payment_type === 'pix' && OFFICIAL_MP_TOKEN) {
      try {
        const pixPayload = {
          transaction_amount: totalAmount,
          description: `Ingresso Cinema: ${MOVIE_TITLE} (${qty}x)`,
          payment_method_id: 'pix',
          external_reference: orderId,
          payer: {
            email: email,
            first_name: customer_name.split(' ')[0],
            last_name: customer_name.split(' ').slice(1).join(' ') || 'Cliente',
            identification: {
              type: 'CPF',
              number: cleanCpf
            }
          },
          additional_info: {
            payer: {
              first_name: customer_name.split(' ')[0],
              last_name: customer_name.split(' ').slice(1).join(' ') || 'Cliente',
              phone: {
                area_code: phoneArea,
                number: phoneNumber
              }
            },
            items: [
              {
                id: 'ticket-daniel-fornalha',
                title: `Ingresso Cinema: ${MOVIE_TITLE}`,
                description: `Sessão ${SESSION_DATETIME} - ${THEATER_NAME} (${qty} ingresso(s))`,
                quantity: qty,
                unit_price: TICKET_PRICE
              }
            ]
          },
          metadata: {
            order_id: orderId,
            ticket_code: ticketCode,
            customer_name: customer_name.trim(),
            customer_email: email.trim().toLowerCase(),
            customer_phone: phone.trim(),
            customer_cpf: cleanCpf,
            quantity: qty,
            children_under_3: kids
          },
          notification_url: `${baseUrl}/api/webhooks/mercadopago`
        };

        const pixRes = await axios.post('https://api.mercadopago.com/v1/payments', pixPayload, {
          headers: {
            'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': orderId
          }
        });

        const pixData = pixRes.data;
        const qrCodePix = pixData.point_of_interaction?.transaction_data?.qr_code;
        const qrCodeBase64 = pixData.point_of_interaction?.transaction_data?.qr_code_base64;

        orderPayload.mp_payment_id = String(pixData.id);
        orderPayload.qr_code_pix = qrCodePix;
        orderPayload.qr_code_base64 = qrCodeBase64;
        memoryOrders.set(orderId, orderPayload);

        return res.json({
          success: true,
          mode: 'pix_direct',
          order_id: orderId,
          ticket_code: ticketCode,
          total_amount: totalAmount,
          quantity: qty,
          children_under_3: kids,
          qr_code_pix: qrCodePix,
          qr_code_base64: qrCodeBase64,
          ticket_url: `/ingresso.html?id=${orderId}`
        });

      } catch (pixErr) {
        console.warn('[Pix Direct Warning] Falha na emissão de PIX direto, caindo para Checkout Pro Preference:', pixErr.response?.data || pixErr.message);
      }
    }

    // CHECKOUT PRO (PREFERENCE MERCADO PAGO - CARTÃO À VISTA, PIX)
    if (OFFICIAL_MP_TOKEN) {
      try {
        const prefPayload = {
          items: [
            {
              id: 'ticket-daniel-fornalha',
              title: `Ingresso Cinema: ${MOVIE_TITLE}`,
              description: `Sessão ${SESSION_DATETIME} - ${THEATER_NAME} (${qty} ingresso(s))`,
              quantity: qty,
              currency_id: 'BRL',
              unit_price: TICKET_PRICE
            }
          ],
          payer: {
            name: customer_name.split(' ')[0],
            surname: customer_name.split(' ').slice(1).join(' ') || 'Cinema',
            email: email,
            phone: {
              area_code: phoneArea,
              number: phoneNumber
            },
            identification: {
              type: 'CPF',
              number: cleanCpf
            }
          },
          metadata: {
            order_id: orderId,
            ticket_code: ticketCode,
            customer_name: customer_name.trim(),
            customer_email: email.trim().toLowerCase(),
            customer_phone: phone.trim(),
            customer_cpf: cleanCpf,
            quantity: qty,
            children_under_3: kids
          },
          back_urls: {
            success: `${baseUrl}/ingresso.html?id=${orderId}&status=success`,
            failure: `${baseUrl}/index.html?error=payment_failed`,
            pending: `${baseUrl}/ingresso.html?id=${orderId}&status=pending`
          },
          auto_return: 'approved',
          external_reference: orderId,
          notification_url: `${baseUrl}/api/webhooks/mercadopago`,
          statement_descriptor: 'CINEMA DANIEL',
          payment_methods: {
            installments: 1,
            default_installments: 1
          }
        };

        const mpRes = await axios.post(
          'https://api.mercadopago.com/checkout/preferences',
          prefPayload,
          {
            headers: {
              'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}`,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': orderId
            }
          }
        );

        const prefData = mpRes.data;
        orderPayload.mp_preference_id = String(prefData.id);
        memoryOrders.set(orderId, orderPayload);

        return res.json({
          success: true,
          mode: 'checkout_pro',
          order_id: orderId,
          ticket_code: ticketCode,
          total_amount: totalAmount,
          quantity: qty,
          children_under_3: kids,
          init_point: prefData.init_point,
          ticket_url: `/ingresso.html?id=${orderId}`
        });

      } catch (mpErr) {
        console.error('[MP Preference Error]:', mpErr.response?.data || mpErr.message);
        return res.status(400).json({
          error: 'Erro ao gerar pagamento no Mercado Pago: ' + (mpErr.response?.data?.message || mpErr.message)
        });
      }
    }

    // Modo simulação caso o token não esteja configurado
    return res.json({
      success: true,
      mode: 'sandbox_simulation',
      order_id: orderId,
      ticket_code: ticketCode,
      total_amount: totalAmount,
      quantity: qty,
      children_under_3: kids,
      ticket_url: `/ingresso.html?id=${orderId}`
    });

  } catch (error) {
    console.error('[Checkout Error]:', error);
    res.status(500).json({ error: 'Erro interno ao processar a compra do ingresso.' });
  }
});

// -------------------------------------------------------------
// HELPER CENTRAL: BUSCA E SINCRONIZAÇÃO MERCADO PAGO
// -------------------------------------------------------------
async function fetchTicketsFromMercadoPago() {
  if (!OFFICIAL_MP_TOKEN) return [];

  try {
    const [paymentsRes, prefsRes] = await Promise.all([
      axios.get('https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=100', {
        headers: { 'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}` }
      }),
      axios.get('https://api.mercadopago.com/checkout/preferences/search?limit=50', {
        headers: { 'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}` }
      })
    ]);

    const payments = paymentsRes.data.results || [];
    const prefs = prefsRes.data.elements || [];

    // Mapeia preferências de cinema com detalhes completos
    const cinemaPrefsMap = new Map();
    const cinemaPrefsList = prefs.filter(p => {
      const itStr = JSON.stringify(p.items || []);
      return itStr.includes('Daniel') || itStr.includes('Cinema') || itStr.includes('Fornalha');
    });

    for (const cp of cinemaPrefsList) {
      try {
        const fullPrefRes = await axios.get(`https://api.mercadopago.com/checkout/preferences/${cp.id}`, {
          headers: { 'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}` }
        });
        const fullPref = fullPrefRes.data;
        if (cp.external_reference) cinemaPrefsMap.set(cp.external_reference, fullPref);
        cinemaPrefsMap.set(cp.id, fullPref);
      } catch (e) {
        if (cp.external_reference) cinemaPrefsMap.set(cp.external_reference, cp);
        cinemaPrefsMap.set(cp.id, cp);
      }
    }

    // Filtra pagamentos do evento de Cinema
    const cinemaPayments = payments.filter(p => {
      const desc = (p.description || '').toLowerCase();
      const isCinema = desc.includes('cinema') || desc.includes('daniel') || desc.includes('fornalha');
      const isTest = desc.includes('teste');
      return isCinema && !isTest;
    });

    const tickets = [];

    for (const p of cinemaPayments) {
      const extRef = p.external_reference || '';
      const pref = cinemaPrefsMap.get(extRef) || null;
      const memOrder = memoryOrders.get(extRef) || memoryOrders.get(String(p.id)) || null;

      let custName = '';
      let custEmail = '';
      let custPhone = '';
      let custCpf = '';
      let kids = 0;
      let ticketCode = '';

      // 1. Dados salvos em memória
      if (memOrder) {
        custName = memOrder.customer_name || custName;
        custEmail = memOrder.email || custEmail;
        custPhone = memOrder.phone || custPhone;
        custCpf = memOrder.cpf || custCpf;
        kids = memOrder.children_under_3 || kids;
        ticketCode = memOrder.ticket_code || ticketCode;
      }

      // 2. Metadata do Mercado Pago
      if (p.metadata) {
        if (p.metadata.customer_name) custName = p.metadata.customer_name;
        if (p.metadata.customer_email) custEmail = p.metadata.customer_email;
        if (p.metadata.customer_phone) custPhone = p.metadata.customer_phone;
        if (p.metadata.customer_cpf) custCpf = p.metadata.customer_cpf;
        if (p.metadata.children_under_3) kids = Number(p.metadata.children_under_3) || kids;
        if (p.metadata.ticket_code) ticketCode = p.metadata.ticket_code;
      }

      // 3. Additional info do Payment
      if (p.additional_info?.payer) {
        const ap = p.additional_info.payer;
        if (!custName && (ap.first_name || ap.last_name)) {
          custName = [ap.first_name, ap.last_name].filter(Boolean).join(' ');
        }
        if (!custPhone && ap.phone?.number) {
          custPhone = [ap.phone.area_code, ap.phone.number].filter(Boolean).join(' ');
        }
      }

      // 4. Preferência vinculada
      if (pref) {
        if (!custName && (pref.payer?.name || pref.payer?.surname)) {
          custName = [pref.payer.name, pref.payer.surname].filter(Boolean).join(' ');
        }
        if (!custEmail && pref.payer?.email) custEmail = pref.payer.email;
        if (!custPhone && pref.payer?.phone?.number) {
          custPhone = [pref.payer.phone.area_code, pref.payer.phone.number].filter(Boolean).join(' ');
        }
        if (!custCpf && pref.payer?.identification?.number) custCpf = pref.payer.identification.number;
        if (pref.metadata?.customer_name && !custName) custName = pref.metadata.customer_name;
        if (pref.metadata?.ticket_code && !ticketCode) ticketCode = pref.metadata.ticket_code;
      }

      // 5. Objeto Payer direto do Payment
      if (p.payer) {
        if (!custName && (p.payer.first_name || p.payer.last_name)) {
          custName = [p.payer.first_name, p.payer.last_name].filter(Boolean).join(' ');
        }
        if (!custEmail && p.payer.email && !p.payer.email.includes('XXXXXXXX')) {
          custEmail = p.payer.email;
        }
        if (!custCpf && p.payer.identification?.number && p.payer.identification.number !== '99999999999') {
          custCpf = p.payer.identification.number;
        }
      }

      // Identificação específica dos pagamentos iniciais realizados via PIX
      if (String(p.id) === '186572981404') {
        custName = 'Dulcinéa S Andrade';
        custEmail = 'dusiandrade@gmail.com';
        custPhone = '(21) 99961-5470';
        custCpf = '803.689.487-49';
      } else if (String(p.id) === '186475844980') {
        custName = 'Comprador Pix (Itaú)';
      }

      if (!ticketCode) {
        ticketCode = 'DAN-' + String(p.id).slice(-5);
      }

      const qty = Math.max(1, Math.round(Number(p.transaction_amount) / TICKET_PRICE));
      const isChecked = checkinStatusMap.get(String(p.id)) || checkinStatusMap.get(extRef) || false;

      tickets.push({
        id: String(p.id),
        order_id: extRef || String(p.id),
        ticket_code: ticketCode,
        customer_name: custName || 'Comprador Ingresso',
        email: custEmail || '-',
        phone: custPhone || '-',
        cpf: custCpf || '-',
        quantity: qty,
        children_under_3: kids,
        total_amount: Number(p.transaction_amount),
        mp_status: p.status,
        mp_status_detail: p.status_detail,
        payment_method: p.payment_method_id,
        date_created: p.date_created,
        checkin_done: Boolean(isChecked),
        movie_title: MOVIE_TITLE,
        session_datetime: SESSION_DATETIME,
        theater_name: THEATER_NAME,
        theater_address: THEATER_ADDRESS
      });
    }

    return tickets;

  } catch (err) {
    console.error('[Mercado Pago Sync Error]:', err.message);
    return [];
  }
}

// -------------------------------------------------------------
// 3. CONSULTA DE INGRESSO (STATUS E DADOS PARA APRESENTAÇÃO)
// -------------------------------------------------------------
app.get('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;

  // 1. Procura em memória
  if (memoryOrders.has(id)) {
    return res.json(memoryOrders.get(id));
  }

  // 2. Procura no Mercado Pago
  try {
    const mpTickets = await fetchTicketsFromMercadoPago();
    const found = mpTickets.find(t => t.id === id || t.order_id === id || t.ticket_code === id);
    if (found) {
      return res.json(found);
    }
  } catch (e) {
    console.warn('[Ticket Lookup MP Error]:', e.message);
  }

  // 3. Procura no Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
      if (data && !error) {
        const parsed = {
          id: data.id,
          customer_name: data.customer_name,
          email: data.email,
          phone: data.phone,
          cpf: data.cpf,
          total_amount: data.total_amount,
          mp_status: data.mp_status,
          movie_title: MOVIE_TITLE,
          session_datetime: SESSION_DATETIME,
          theater_name: THEATER_NAME,
          theater_address: THEATER_ADDRESS,
          created_at: data.created_at,
          details: data.complement || data.shipping_service_name
        };
        return res.json(parsed);
      }
    } catch (err) {
      console.warn('[Ticket Lookup Supabase Error]:', err.message);
    }
  }

  return res.status(404).json({ error: 'Ingresso não encontrado.' });
});

// -------------------------------------------------------------
// 4. CHECK-IN NA ENTRADA DO CINEMA
// -------------------------------------------------------------
app.post('/api/admin/checkin/:id', async (req, res) => {
  const { id } = req.params;
  const { password, status = true } = req.body;

  if (password !== (process.env.ADMIN_PASSWORD || 'laranjachurrasco')) {
    return res.status(401).json({ error: 'Senha de administrador inválida.' });
  }

  const isCheckin = Boolean(status);
  checkinStatusMap.set(id, isCheckin);

  if (memoryOrders.has(id)) {
    const ord = memoryOrders.get(id);
    ord.checkin_done = isCheckin;
    ord.checkin_at = isCheckin ? new Date().toISOString() : null;
    memoryOrders.set(id, ord);
  }

  if (supabase) {
    try {
      await supabase.from('orders').update({
        shipping_status: isCheckin ? 'Check-in Realizado (Entrada Confirmada)' : 'Pendente de Entrada',
        updated_at: new Date().toISOString()
      }).eq('id', id);
    } catch (err) {}
  }

  return res.json({ 
    success: true, 
    checkin_done: isCheckin,
    message: isCheckin ? 'Check-in confirmado com sucesso! Entrada liberada.' : 'Check-in desfeito com sucesso.' 
  });
});

// -------------------------------------------------------------
// 5. LISTAGEM DE INGRESSOS PARA O ADMIN (MERCADO PAGO EM TEMPO REAL)
// -------------------------------------------------------------
app.get('/api/admin/tickets', async (req, res) => {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  if (pwd !== (process.env.ADMIN_PASSWORD || 'laranjachurrasco')) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  try {
    // 1. Busca tickets sincronizados diretamente do Mercado Pago
    const mpTickets = await fetchTicketsFromMercadoPago();

    // 2. Mescla com pedidos em memória que ainda não foram sincronizados
    const allTicketsMap = new Map();

    for (const t of mpTickets) {
      allTicketsMap.set(t.id, t);
      if (t.order_id) allTicketsMap.set(t.order_id, t);
    }

    for (const [memId, memTicket] of memoryOrders.entries()) {
      if (!allTicketsMap.has(memId) && !allTicketsMap.has(memTicket.mp_payment_id)) {
        allTicketsMap.set(memId, {
          ...memTicket,
          checkin_done: checkinStatusMap.get(memId) || memTicket.checkin_done || false
        });
      }
    }

    // 3. Recupera tickets únicos
    const uniqueTickets = Array.from(new Set(allTicketsMap.values()));

    return res.json({ tickets: uniqueTickets });

  } catch (error) {
    console.error('[Admin Tickets Error]:', error);
    return res.json({ tickets: Array.from(memoryOrders.values()) });
  }
});

// -------------------------------------------------------------
// 6. WEBHOOK DO MERCADO PAGO
// -------------------------------------------------------------
app.post('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment' && data?.id && OFFICIAL_MP_TOKEN) {
      const mpRes = await axios.get(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { 'Authorization': `Bearer ${OFFICIAL_MP_TOKEN}` }
      });
      const paymentInfo = mpRes.data;
      const orderId = paymentInfo.external_reference;

      if (orderId) {
        if (memoryOrders.has(orderId)) {
          const ord = memoryOrders.get(orderId);
          ord.mp_status = paymentInfo.status;
          ord.mp_payment_id = String(data.id);
          memoryOrders.set(orderId, ord);
        }

        if (supabase) {
          try {
            await supabase.from('orders').update({
              mp_status: paymentInfo.status,
              mp_payment_id: String(data.id),
              updated_at: new Date().toISOString()
            }).eq('id', orderId);
          } catch (e) {}
        }
        console.log(`[Webhook MP Cinema] Pagamento ${data.id} para pedido ${orderId}: ${paymentInfo.status}`);
      }
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[Webhook MP Cinema Error]:', err.message);
    return res.status(200).send('OK');
  }
});

// Inicialização local para desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🎬 Servidor de Ingressos Cinema online na porta ${PORT}`);
    console.log(`🍿 Filme: ${MOVIE_TITLE} | Sessão: ${SESSION_DATETIME}`);
  });
}

export default app;
