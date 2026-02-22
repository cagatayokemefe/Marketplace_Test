const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory state ──────────────────────────────────────────────────────────

const stocks = {
  AAPL: {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 178.50,
    previousClose: 175.20,
    description: 'Technology company known for iPhone, Mac, and services.',
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    price: 242.80,
    previousClose: 238.60,
    description: 'Electric vehicle and clean energy company.',
  },
};

// Simulate slight price fluctuations every 5 seconds
setInterval(() => {
  for (const symbol in stocks) {
    const stock = stocks[symbol];
    const change = (Math.random() - 0.48) * 2; // slight upward bias
    stock.price = Math.max(1, parseFloat((stock.price + change).toFixed(2)));
  }
}, 5000);

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/stocks  –  list all stocks with current prices
app.get('/api/stocks', (req, res) => {
  const result = Object.values(stocks).map((s) => ({
    ...s,
    change: parseFloat((s.price - s.previousClose).toFixed(2)),
    changePct: parseFloat((((s.price - s.previousClose) / s.previousClose) * 100).toFixed(2)),
  }));
  res.json(result);
});

// GET /api/stocks/:symbol  –  single stock detail
app.get('/api/stocks/:symbol', (req, res) => {
  const stock = stocks[req.params.symbol.toUpperCase()];
  if (!stock) return res.status(404).json({ error: 'Stock not found' });
  res.json({
    ...stock,
    change: parseFloat((stock.price - stock.previousClose).toFixed(2)),
    changePct: parseFloat((((stock.price - stock.previousClose) / stock.previousClose) * 100).toFixed(2)),
  });
});

// POST /api/buy  –  { symbol, quantity, balance, portfolio }
app.post('/api/buy', (req, res) => {
  const { symbol, quantity } = req.body;
  const sym = (symbol || '').toUpperCase();
  const qty = parseInt(quantity, 10);

  if (!stocks[sym]) return res.status(400).json({ error: 'Invalid stock symbol' });
  if (!qty || qty < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

  const stock = stocks[sym];
  const cost = parseFloat((stock.price * qty).toFixed(2));

  res.json({ symbol: sym, quantity: qty, price: stock.price, total: cost });
});

// POST /api/sell  –  { symbol, quantity }
app.post('/api/sell', (req, res) => {
  const { symbol, quantity } = req.body;
  const sym = (symbol || '').toUpperCase();
  const qty = parseInt(quantity, 10);

  if (!stocks[sym]) return res.status(400).json({ error: 'Invalid stock symbol' });
  if (!qty || qty < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

  const stock = stocks[sym];
  const proceeds = parseFloat((stock.price * qty).toFixed(2));

  res.json({ symbol: sym, quantity: qty, price: stock.price, total: proceeds });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stock Marketplace running at http://localhost:${PORT}`);
});
