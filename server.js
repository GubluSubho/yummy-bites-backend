require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/estimate', require('./routes/estimate'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/payment', require('./routes/payment'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    const { expireUnpaidOrders } = require('./utils/payments');
    setInterval(expireUnpaidOrders, 60 * 1000);
  })
  .catch((err) => console.log('MongoDB error:', err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
