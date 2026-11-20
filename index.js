const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const createAuthMiddlewares = require('./middlewares/authMiddleware');

const app = express();
const port = process.env.PORT || 5000;

// MongoDB Setup
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const db = client.db(process.env.DB_NAME || 'salonBookDB');
app.locals.db = db;

const usersCollection = db.collection('user'); // Better Auth 'user' collection
const servicesCollection = db.collection('services');
const appointmentsCollection = db.collection('appointments');
const transactionsCollection = db.collection('transactions');
const reviewsCollection = db.collection('reviews');

const { verifyToken, verifyAdmin, verifyCustomer } = createAuthMiddlewares(
  usersCollection,
  db
);

// ==========================================
// 0. INITIAL DATA SEEDING (7 Active Services)
// ==========================================
async function seedInitialServices() {
  try {
    const count = await servicesCollection.countDocuments();
    if (count === 0) {
      const defaultServices = [
        {
          serviceName: 'Signature Haircut & Blowout',
          category: 'Haircut & Styling',
          description:
            'Precision haircut tailored to your face shape followed by a nourishing wash and voluminous blowout.',
          price: 45,
          duration: 60,
          image:
            'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Balayage & Gloss Coloring',
          category: 'Hair Coloring',
          description:
            'Hand-painted natural highlights blended seamlessly with a shine-enhancing gloss treatment.',
          price: 140,
          duration: 150,
          image:
            'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Keratin Smooth Therapy',
          category: 'Hair Treatment',
          description:
            'Deep frizz-control keratin infusion that restores smoothness and manageability for up to 12 weeks.',
          price: 120,
          duration: 120,
          image:
            'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Hydra-Glow Botanical Facial',
          category: 'Facial & Skincare',
          description:
            'Deep pore cleansing, gentle enzyme exfoliation, and hyaluronic hydration mask for radiant skin.',
          price: 75,
          duration: 60,
          image:
            'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Bridal & Evening Glam Makeup',
          category: 'Makeup',
          description:
            'Long-wear HD airbrush or soft-glam makeup application with custom lash styling.',
          price: 95,
          duration: 90,
          image:
            'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Deluxe Gel Manicure & Spa Pedicure',
          category: 'Manicure & Pedicure',
          description:
            'Cuticle care, sea-salt scrub, relaxing massage, and chip-free gel polish finish.',
          price: 65,
          duration: 75,
          image:
            'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800',
          status: 'active',
          createdAt: new Date(),
        },
        {
          serviceName: 'Aromatherapy Deep Tissue Massage',
          category: 'Spa & Massage',
          description:
            'Full-body tension relief massage using warm essential oils to soothe sore muscles.',
          price: 85,
          duration: 60,
          image:
            'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800',
          status: 'active',
          createdAt: new Date(),
        },
      ];
      await servicesCollection.insertMany(defaultServices);
      console.log('Seeded 7 initial salon services.');
    }
  } catch (err) {
    console.error('Seeding error:', err.message);
  }
}
seedInitialServices();

const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((url) => url.trim())
  : ['http://localhost:3000'];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-email'],
  })
);

// ==========================================
// 1. STRIPE WEBHOOK (MUST BE BEFORE express.json)
// ==========================================
app.post(
  '/api/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { appointmentId, customerId } = session.metadata;

      await appointmentsCollection.updateOne(
        { _id: new ObjectId(appointmentId) },
        { $set: { status: 'confirmed', paymentStatus: 'paid' } }
      );

      const existingTx = await transactionsCollection.findOne({
        stripeSessionId: session.id,
      });

      if (!existingTx) {
        await transactionsCollection.insertOne({
          appointmentId: new ObjectId(appointmentId),
          customerId: customerId,
          amount: session.amount_total / 100,
          currency: session.currency.toUpperCase(),
          stripeSessionId: session.id,
          status: 'paid',
          createdAt: new Date(),
        });
      }
    }

    res.json({ received: true });
  }
);

// ==========================================
// 2. STANDARD MIDDLEWARES
// ==========================================
app.use(express.json());
app.use(cookieParser());

// ==========================================
// 3. AUTH & USER PROFILE ROUTES
// ==========================================
app.post('/api/auth/jwt', async (req, res) => {
  try {
    const { email, name, image } = req.body;
    if (!email) return res.status(400).send({ message: 'Email is required' });

    let user = await usersCollection.findOne({ email });
    if (!user) {
      const newUser = {
        name: name || 'User',
        email,
        image: image || '',
        role: 'customer',
        isBlocked: false,
        createdAt: new Date(),
      };
      const result = await usersCollection.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    } else if (!user.role) {
      await usersCollection.updateOne(
        { email },
        { $set: { role: 'customer', isBlocked: false } }
      );
      user.role = 'customer';
      user.isBlocked = false;
    }

    if (user.isBlocked) {
      return res
        .status(403)
        .send({ message: 'Your account has been blocked by admin.' });
    }

    const token = jwt.sign(
      { email: user.email, role: user.role },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '7d' }
    );

    res
      .cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      })
      .send({ success: true, user });
  } catch (error) {
    res
      .status(500)
      .send({ message: 'Failed to generate token', error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res
    .clearCookie('token', {
      maxAge: 0,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    })
    .send({ success: true });
});

app.get('/api/users/me', verifyToken, async (req, res) => {
  const user = await usersCollection.findOne({ email: req.user.email });
  res.send(user);
});

app.patch('/api/users/profile', verifyToken, async (req, res) => {
  try {
    const { name, image, phone } = req.body;
    const updateDoc = { $set: {} };
    if (name) updateDoc.$set.name = name;
    if (image) updateDoc.$set.image = image;
    if (phone !== undefined) updateDoc.$set.phone = phone;

    const result = await usersCollection.updateOne(
      { email: req.user.email },
      updateDoc
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to update profile' });
  }
});

// ==========================================
// 4. SERVICES ROUTES (Public + Admin)
// ==========================================
app.get('/api/services', async (req, res) => {
  try {
    const { search, category, sort, limit } = req.query;
    const query = { status: 'active' };

    if (search) {
      query.serviceName = { $regex: search, $options: 'i' };
    }
    if (category && category !== 'All') {
      query.category = category;
    }

    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') sortOption = { price: 1 };
    if (sort === 'price_desc') sortOption = { price: -1 };

    let cursor = servicesCollection.find(query).sort(sortOption);
    if (limit) cursor = cursor.limit(parseInt(limit));

    const services = await cursor.toArray();
    res.send(services);
  } catch (error) {
    res.status(500).send({ message: 'Error fetching services' });
  }
});

app.get('/api/admin/services', verifyToken, verifyAdmin, async (req, res) => {
  const services = await servicesCollection
    .find()
    .sort({ createdAt: -1 })
    .toArray();
  res.send(services);
});

app.get('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: 'Invalid service ID format' });
    }
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
    if (!service) {
      return res.status(404).send({ message: 'Service not found' });
    }
    res.send(service);
  } catch (error) {
    res.status(500).send({ message: 'Error fetching service details' });
  }
});

app.post('/api/services', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const {
      serviceName,
      title,
      name,
      category,
      description,
      price,
      duration,
      image,
      status,
    } = req.body;
    const finalName = serviceName || title || name;

    if (!finalName || !category || Number(price) <= 0 || Number(duration) <= 0) {
      return res.status(400).send({
        message:
          'Invalid service data. Name, category, positive price and duration are required.',
      });
    }

    const newService = {
      serviceName: finalName,
      category,
      description: description || '',
      price: Number(price),
      duration: Number(duration),
      image: image || '',
      status: status || 'active',
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to add service' });
  }
});

app.patch('/api/services/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: 'Invalid ID' });

    const {
      serviceName,
      title,
      category,
      description,
      price,
      duration,
      image,
      status,
    } = req.body;
    const updateFields = {};

    if (serviceName || title) updateFields.serviceName = serviceName || title;
    if (category) updateFields.category = category;
    if (description !== undefined) updateFields.description = description;
    if (price !== undefined) {
      if (Number(price) <= 0)
        return res.status(400).send({ message: 'Price must be positive' });
      updateFields.price = Number(price);
    }
    if (duration !== undefined) {
      if (Number(duration) <= 0)
        return res.status(400).send({ message: 'Duration must be positive' });
      updateFields.duration = Number(duration);
    }
    if (image) updateFields.image = image;
    if (status) updateFields.status = status;

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to update service' });
  }
});

app.delete('/api/services/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: 'Invalid ID' });

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(id),
    });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to delete service' });
  }
});

// ==========================================
// 5. APPOINTMENTS ROUTES
// ==========================================
app.post('/api/appointments', verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { serviceId, appointmentDate, date, timeSlot, time, message, notes } =
      req.body;
    const finalDate = appointmentDate || date;
    const finalTime = timeSlot || time;

    if (!ObjectId.isValid(serviceId) || !finalDate || !finalTime) {
      return res
        .status(400)
        .send({ message: 'Valid service, date, and time slot are required.' });
    }

    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
    });
    if (!service || service.status !== 'active') {
      return res
        .status(400)
        .send({ message: 'This service is currently unavailable for booking.' });
    }

    const conflict = await appointmentsCollection.findOne({
      appointmentDate: finalDate,
      timeSlot: finalTime,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (conflict) {
      return res.status(409).send({
        message:
          'This time slot is already booked. Please choose another time.',
      });
    }

    const newAppointment = {
      serviceId: new ObjectId(serviceId),
      customerId: req.user._id,
      customerEmail: req.user.email,
      customerName: req.user.name,
      appointmentDate: finalDate,
      timeSlot: finalTime,
      message: message || notes || '',
      servicePrice: service.price,
      paymentStatus: 'unpaid',
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await appointmentsCollection.insertOne(newAppointment);
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to book appointment' });
  }
});

app.get('/api/appointments/my', verifyToken, verifyCustomer, async (req, res) => {
  try {
    const appointments = await appointmentsCollection
      .aggregate([
        {
          $match: {
            $or: [
              { customerId: req.user._id },
              { customerEmail: req.user.email },
            ],
          },
        },
        {
          $lookup: {
            from: 'services',
            localField: 'serviceId',
            foreignField: '_id',
            as: 'service',
          },
        },
        { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    res.send(appointments);
  } catch (error) {
    res.status(500).send({ message: 'Failed to load appointments' });
  }
});

app.patch(
  '/api/appointments/:id/cancel',
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { id } = req.params;
      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(id),
        $or: [{ customerId: req.user._id }, { customerEmail: req.user.email }],
      });

      if (!appointment) {
        return res.status(404).send({ message: 'Appointment not found' });
      }

      if (appointment.status !== 'pending') {
        return res.status(400).send({
          message: 'Only pending appointments can be cancelled.',
        });
      }

      const result = await appointmentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'cancelled' } }
      );
      res.send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to cancel appointment' });
    }
  }
);

app.get(
  '/api/admin/appointments',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const appointments = await appointmentsCollection
        .aggregate([
          {
            $lookup: {
              from: 'services',
              localField: 'serviceId',
              foreignField: '_id',
              as: 'service',
            },
          },
          {
            $lookup: {
              from: 'user',
              localField: 'customerEmail',
              foreignField: 'email',
              as: 'customer',
            },
          },
          { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
          { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
          { $sort: { createdAt: -1 } },
        ])
        .toArray();

      res.send(appointments);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch all appointments' });
    }
  }
);

app.patch(
  '/api/admin/appointments/:id/status',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!['confirmed', 'cancelled'].includes(status)) {
        return res.status(400).send({ message: 'Invalid status' });
      }

      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!appointment)
        return res.status(404).send({ message: 'Appointment not found' });

      if (status === 'confirmed' && appointment.status !== 'pending') {
        return res
          .status(400)
          .send({ message: 'Only pending appointments can be confirmed.' });
      }

      const result = await appointmentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to update appointment status' });
    }
  }
);

// ==========================================
// 6. STRIPE PAYMENT & TRANSACTIONS ROUTES
// ==========================================
app.post(
  '/api/payments/create-checkout-session',
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { appointmentId } = req.body;
      const appointment = await appointmentsCollection.findOne({
        _id: new ObjectId(appointmentId),
        $or: [{ customerId: req.user._id }, { customerEmail: req.user.email }],
      });

      if (!appointment) {
        return res.status(404).send({ message: 'Appointment not found' });
      }
      if (appointment.paymentStatus === 'paid') {
        return res
          .status(400)
          .send({ message: 'This appointment is already paid.' });
      }

      const service = await servicesCollection.findOne({
        _id: appointment.serviceId,
      });
      const frontendOrigin = (
        process.env.CLIENT_URL || 'http://localhost:3000'
      )
        .split(',')[0]
        .trim();

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: req.user.email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: service?.serviceName || 'Salon Service',
                description: `Appointment on ${appointment.appointmentDate} at ${appointment.timeSlot}`,
              },
              unit_amount: Math.round(appointment.servicePrice * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          appointmentId: appointment._id.toString(),
          customerId: req.user._id,
        },
        success_url: `${frontendOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}&appointmentId=${appointment._id.toString()}`,
        cancel_url: `${frontendOrigin}/dashboard/customer`,
      });

      res.send({ url: session.url });
    } catch (error) {
      res
        .status(500)
        .send({ message: 'Stripe session error', error: error.message });
    }
  }
);

app.post('/api/payments/confirm', verifyToken, async (req, res) => {
  try {
    const { sessionId, appointmentId } = req.body;
    if (!sessionId)
      return res.status(400).send({ message: 'Session ID required' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(400).send({ message: 'Payment not completed yet' });
    }

    const targetId = appointmentId || session.metadata?.appointmentId;
    if (targetId && ObjectId.isValid(targetId)) {
      await appointmentsCollection.updateOne(
        { _id: new ObjectId(targetId) },
        {
          $set: {
            status: 'confirmed',
            paymentStatus: 'paid',
            stripeSessionId: session.id,
          },
        }
      );
    }

    const existingTx = await transactionsCollection.findOne({
      stripeSessionId: session.id,
    });
    if (!existingTx && targetId) {
      await transactionsCollection.insertOne({
        appointmentId: new ObjectId(targetId),
        customerId: req.user._id,
        customerEmail: req.user.email,
        amount: session.amount_total / 100,
        currency: session.currency.toUpperCase(),
        stripeSessionId: session.id,
        status: 'paid',
        createdAt: new Date(),
      });
    }

    res.send({ success: true, status: 'confirmed' });
  } catch (error) {
    res.status(500).send({ message: 'Failed to confirm payment' });
  }
});

app.get(
  '/api/payments/session/:sessionId',
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const transaction = await transactionsCollection.findOne({
        stripeSessionId: sessionId,
        $or: [{ customerId: req.user._id }, { customerEmail: req.user.email }],
      });

      if (!transaction) {
        return res.status(404).send({
          message:
            'Payment confirmation is still processing or session not found.',
        });
      }

      res.send(transaction);
    } catch (error) {
      res.status(500).send({ message: 'Failed to retrieve payment session' });
    }
  }
);

app.get(
  '/api/admin/transactions',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const transactions = await transactionsCollection
        .aggregate([
          {
            $lookup: {
              from: 'user',
              localField: 'customerEmail',
              foreignField: 'email',
              as: 'customer',
            },
          },
          {
            $lookup: {
              from: 'appointments',
              localField: 'appointmentId',
              foreignField: '_id',
              as: 'appointment',
            },
          },
          { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
          {
            $unwind: {
              path: '$appointment',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: 'services',
              localField: 'appointment.serviceId',
              foreignField: '_id',
              as: 'service',
            },
          },
          { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
          { $sort: { createdAt: -1 } },
        ])
        .toArray();

      res.send(transactions);
    } catch (error) {
      res.status(500).send({ message: 'Failed to load transactions' });
    }
  }
);

// ==========================================
// 7. VERIFIED REVIEWS ROUTES
// ==========================================
app.get('/api/reviews/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const reviews = await reviewsCollection
      .find({ serviceId })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(reviews);
  } catch (error) {
    res.status(500).send({ message: 'Failed to load reviews' });
  }
});

app.post('/api/reviews', verifyToken, verifyCustomer, async (req, res) => {
  try {
    const { serviceId, appointmentId, rating, comment } = req.body;
    if (!serviceId || !rating || !comment) {
      return res
        .status(400)
        .send({ message: 'Service, rating, and comment are required.' });
    }

    const review = {
      serviceId,
      appointmentId: appointmentId || null,
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      rating: Math.min(5, Math.max(1, Number(rating))),
      comment: comment.trim(),
      createdAt: new Date(),
    };

    const result = await reviewsCollection.insertOne(review);
    if (appointmentId && ObjectId.isValid(appointmentId)) {
      await appointmentsCollection.updateOne(
        { _id: new ObjectId(appointmentId) },
        { $set: { isReviewed: true } }
      );
    }

    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to submit review' });
  }
});

// ==========================================
// 8. ADMIN USER MANAGEMENT & DASHBOARD STATS
// ==========================================
app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection
    .find({ role: { $ne: 'admin' } })
    .sort({ createdAt: -1 })
    .toArray();
  res.send(users);
});

app.patch(
  '/api/admin/users/:id/block',
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isBlocked } = req.body;
      const query = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { id }] }
        : { id };

      const result = await usersCollection.updateOne(query, {
        $set: { isBlocked: Boolean(isBlocked) },
      });
      res.send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to update user status' });
    }
  }
);

app.get('/api/admin/stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const totalCustomers = await usersCollection.countDocuments({
      role: 'customer',
    });
    const activeServices = await servicesCollection.countDocuments({
      status: 'active',
    });
    const totalAppointments = await appointmentsCollection.countDocuments();
    const pendingAppointments = await appointmentsCollection.countDocuments({
      status: 'pending',
    });
    const confirmedAppointments = await appointmentsCollection.countDocuments({
      status: 'confirmed',
    });
    const totalSuccessfulPayments =
      await transactionsCollection.countDocuments({ status: 'paid' });

    res.send({
      totalCustomers,
      activeServices,
      totalAppointments,
      pendingAppointments,
      confirmedAppointments,
      totalSuccessfulPayments,
    });
  } catch (error) {
    res.status(500).send({ message: 'Failed to load admin stats' });
  }
});

app.get(
  '/api/customer/stats',
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    try {
      const filter = {
        $or: [{ customerId: req.user._id }, { customerEmail: req.user.email }],
      };
      const totalRequests =
        await appointmentsCollection.countDocuments(filter);
      const pending = await appointmentsCollection.countDocuments({
        ...filter,
        status: 'pending',
      });
      const confirmed = await appointmentsCollection.countDocuments({
        ...filter,
        status: 'confirmed',
      });
      const cancelled = await appointmentsCollection.countDocuments({
        ...filter,
        status: 'cancelled',
      });

      res.send({ totalRequests, pending, confirmed, cancelled });
    } catch (error) {
      res.status(500).send({ message: 'Failed to load customer stats' });
    }
  }
);

// ==========================================
// 9. GLOBAL 404 & ERROR HANDLER
// ==========================================
app.get('/', (req, res) => {
  res.send('SalonBook Server is running!');
});

app.use((req, res) => {
  res.status(404).send({ message: 'API route not found' });
});

app.listen(port, () => {
  console.log(`SalonBook Server listening on port ${port}`);
});

module.exports = app;