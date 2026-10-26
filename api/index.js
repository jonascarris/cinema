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

// Inicializa Supabase
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Armazenamento em memória caso o Supabase não esteja disponível
const memoryOrders = new Map();

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

    const orderPayload = {
      id: orderId,
      ticket_code: ticketCode,
      customer_name: customer_name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      cpf: cpf.replace(/\D/g, ''),
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

    // Tenta persistir no Supabase na tabela cinema_tickets ou orders
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
          console.warn('[Supabase Warning] Não foi possível salvar em orders, mantendo em memória:', sbError.message);
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
        const cleanCpf = cpf.replace(/\D/g, '');
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
        // Segue adiante para Checkout Pro caso a conta não tenha autorização direta de PIX
      }
    }

    // CHECKOUT PRO (PREFERENCE MERCADO PAGO - CARTÃO, PIX, PARCELAMENTO)
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
              area_code: phone.replace(/\D/g, '').substring(0, 2) || '21',
              number: phone.replace(/\D/g, '').substring(2) || '999999999'
            },
            identification: {
              type: 'CPF',
              number: cpf.replace(/\D/g, '')
            }
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

    // Modo simulação caso o token falhe
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
// 3. CONSULTA DE INGRESSO (STATUS E DADOS PARA APRESENTAÇÃO)
// -------------------------------------------------------------
app.get('/api/tickets/:id', async (req, res) => {
  const { id } = req.params;

  // 1. Procura em memória
  if (memoryOrders.has(id)) {
    return res.json(memoryOrders.get(id));
  }

  // 2. Procura no Supabase
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
      console.warn('[Ticket Lookup Error]:', err.message);
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
  let found = false;

  if (memoryOrders.has(id)) {
    const ord = memoryOrders.get(id);
    ord.checkin_done = isCheckin;
    ord.checkin_at = isCheckin ? new Date().toISOString() : null;
    memoryOrders.set(id, ord);
    found = true;
  }

  if (supabase) {
    try {
      await supabase.from('orders').update({
        shipping_status: isCheckin ? 'Check-in Realizado (Entrada Confirmada)' : 'Pendente de Entrada',
        updated_at: new Date().toISOString()
      }).eq('id', id);
      found = true;
    } catch (err) {}
  }

  if (found) {
    return res.json({ 
      success: true, 
      checkin_done: isCheckin,
      message: isCheckin ? 'Check-in confirmado com sucesso! Entrada liberada.' : 'Check-in desfeito com sucesso.' 
    });
  }
  return res.status(404).json({ error: 'Ingresso não encontrado.' });
});

// -------------------------------------------------------------
// 5. LISTAGEM DE INGRESSOS PARA O ADMIN
// -------------------------------------------------------------
app.get('/api/admin/tickets', async (req, res) => {
  const pwd = req.headers['x-admin-password'] || req.query.password;
  if (pwd !== (process.env.ADMIN_PASSWORD || 'laranjachurrasco')) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  let list = Array.from(memoryOrders.values());

  if (supabase) {
    try {
      const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (data && data.length > 0) {
        // Filtra pedidos relacionados a cinema ou une com memória
        const dbTickets = data.filter(d => (d.complement && d.complement.includes('FILME')) || (d.shipping_service_name && d.shipping_service_name.includes('Cinema')));
        return res.json({ tickets: dbTickets.length > 0 ? dbTickets : list });
      }
    } catch (e) {}
  }

  return res.json({ tickets: list });
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
          await supabase.from('orders').update({
            mp_status: paymentInfo.status,
            mp_payment_id: String(data.id),
            updated_at: new Date().toISOString()
          }).eq('id', orderId);
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
