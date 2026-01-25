const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();


/* =========================
   MIDDLEWARE
========================= */

app.use(cors(
    {
        origin: [
            "http://localhost:5173",
            "https://air-office-28b26.web.app",
            "https://air-office-28b26.firebaseapp.com"
        ],
        credentials: true,
    }
));
app.use(express.json());
app.use(cookieParser());

//custom middleware to verify jwt token
const verifyToken = async (req, res, next) => {
    //token from cookie
    const token = req?.cookies?.token;
    // console.log(token);
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }

    //verify token
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' });
        }
        req.decoded = decoded;
        next();
    });
};



app.get("/", (req, res) => {
    res.send("Welcome to the Airoffice System");
});


/* =========================
   MongoDB Connection
========================= */


const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        // Get the database and collection on which to run the operation
        const database = client.db("airofficeDB");
        const bookings = database.collection("bookings");
        const topups = database.collection("topups");
        const users = database.collection("users");
        const hajjReservation = database.collection("hajj-reservation");


        //jwt token api ------------------------------
        app.post('/api/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '365d' });


            res.cookie("token", token, {
                httpOnly: true,
                secure: true,
                sameSite: "none",
                path: "/",
            });

            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
            res.send({ status: true });
        });


        //end jwt token api ------------------------------

        /* =========================
            CREATE BOOKING
        ========================= */

        app.post("/api/bookings", verifyToken, async (req, res) => {
            try {

                const booking = {
                    agency: req.body.agency, // name, contactPerson, phone, address

                    flight: {
                        segments: req.body.flight.segments, // array of routes
                        passengers: req.body.flight.passengers,
                        capacity: req.body.flight.capacity,
                        // infants: req.body.flight.infants,
                    },

                    fare: req.body.fare, // perPassenger, totalFare
                    callerName: req.body.callerName, //callerName

                    payment: {
                        paidAmount: req.body.payment?.paidAmount || 0,
                        dueAmount: req.body.payment?.dueAmount || req.body.fare.totalFare,
                        status: req.body.payment?.status || "pending",
                        history: []
                    },

                    createdAt: new Date()
                };
                console.log(booking);

                const result = await bookings.insertOne(booking);
                res.send(result);

            } catch (error) {
                res.status(500).send({ error: "Failed to create booking" });
            }
        });

        /* =========================
           GET ALL BOOKINGS
        ========================= */

        app.get("/api/bookings", verifyToken, async (req, res) => {

            const result = await bookings.find().sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        /* =========================
           SEARCH BY DEPARTURE DATE
        ========================= */

        app.get("/api/bookings/by-date", verifyToken, async (req, res) => {
            const { date } = req.query;


            const result = await bookings.find({
                "flight.segments.0.date": date
            }).sort({ createdAt: -1 }).toArray();

            res.send(result);
        });


        // single booking patch api
        /* =========================
            UPDATE BOOKING (EDIT)
        ========================= */
        /* =========================
     UPDATE BOOKING (EDIT)
  ========================= */
        app.patch("/api/bookings/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                // get existing booking
                const existingBooking = await bookings.findOne({
                    _id: new ObjectId(id)
                });

                if (!existingBooking) {
                    return res.status(404).send({ message: "Booking not found" });
                }

                const oldPaidAmount = Number(existingBooking.payment?.paidAmount || 0);
                const newTotalFare = Number(req.body.fare?.totalFare || 0);

                // recalculate due
                const newDueAmount = newTotalFare - oldPaidAmount;

                const updateDoc = {
                    $set: {
                        agency: req.body.agency,
                        flight: req.body.flight,
                        fare: req.body.fare,
                        callerName: req.body.callerName,

                        "payment.dueAmount": newDueAmount < 0 ? 0 : newDueAmount,

                        updatedAt: new Date()
                    }
                };

                console.log(updateDoc);
                const result = await bookings.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                res.send({
                    success: true,
                    modifiedCount: result.modifiedCount,
                    recalculatedDue: newDueAmount
                });

            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to update booking" });
            }
        });

        /* =========================
           SEARCH BY DATE + AGENCY
        ========================= */

        app.get("/api/bookings/search", verifyToken, async (req, res) => {
            const { date, agency } = req.query;


            const query = {
                "flight.segments.0.date": date,
                "agency.name": agency
            };

            const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        /* =========================
           ADD PAYMENT TO BOOKING
        ========================= */

        app.patch("/api/bookings/:id/payment", verifyToken, async (req, res) => {
            const { id } = req.params;
            const { amount, note } = req.body;



            await bookings.updateOne(
                { _id: new ObjectId(id) },
                {
                    $push: {
                        "payment.history": {
                            date: new Date(),
                            amount,
                            note
                        }
                    },
                    $inc: {
                        "payment.paidAmount": amount,
                        "payment.dueAmount": -amount
                    }
                }
            );

            res.send({ success: true });
        });


        /*=========================
            DELETE BOOKING
        ========================= */
        app.delete("/api/bookings/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                const result = await bookings.deleteOne({
                    _id: new ObjectId(id)
                });

                res.send({ success: true, deletedCount: result.deletedCount });
            } catch (err) {
                res.status(500).send({ error: "Failed to delete booking" });
            }
        });



        /* =========================
   CREATE TOPUP (CREDIT / DEBIT)
========================= */
        app.post("/api/topups", verifyToken, async (req, res) => {
            try {


                const {
                    type,
                    date,
                    time,
                    amount,
                    pnr,
                    description,
                    callerName
                } = req.body;

                if (!type || !date || !time || !amount) {
                    return res.status(400).send({ message: "Required fields missing" });
                }

                if (type === "debit" && !pnr) {
                    return res.status(400).send({ message: "PNR required for debit" });
                }

                const doc = {
                    type,
                    date,
                    time,
                    amount: Number(amount),
                    pnr: type === "debit" ? pnr : null,
                    description,
                    callerName,
                    createdAt: new Date()
                };
                console.log(doc);

                const result = await topups.insertOne(doc);
                res.send({ success: true, insertedId: result.insertedId });

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        /* =========================
           GET TOPUP LEDGER
        ========================= */
        app.get("/api/topups", verifyToken, async (req, res) => {
            try {


                const topup = await topups
                    .find()
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(topup);

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });



        // users api --------------------------------

        //user get by email api
        // app.get('/api/v1/users', verifyToken, verifyAdmin, async (req, res) => {

        //     const cursor = users.find({});
        //     const result = await cursor.toArray();
        //     res.send(result);
        // });


        //single user get api
        app.get('/api/users/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await users.findOne(query);
            res.send(result);
        });


        //user post api
        app.post('/api/users', async (req, res) => {
            const user = req.body;
            const { email } = user;

            const existingUser = await users.findOne({ email: email });
            if (existingUser) {
                res.send({ message: "This user already exists" });
            } else {
                const result = await users.insertOne(user);
                res.send(result);
            }
        });

        //single user delete api
        // app.delete('/api/v1/users/:email', verifyToken, verifyAdmin, async (req, res) => {
        //     const email = req.params.email;
        //     const query = { email: email };
        //     const result = await users.deleteOne(query);
        //     res.send(result);
        // });



        //logout api
        app.post('/api/logout', (req, res) => {
            res.clearCookie("token", {
                httpOnly: true,
                secure: true,
                sameSite: "none",
                path: "/",
            });

            res.send({ message: 'Logged out successfully' });
        });
        //end users api --------------------------------


        // hajj reservation collection post api
        app.post("/api/hajj/reservations", verifyToken, async (req, res) => {
            try {
                const doc = {
                    agency: req.body.agency,
                    flight: req.body.flight,
                    fare: req.body.fare,
                    createdAt: new Date(),
                    callerName: req.body.callerName
                };

                console.log(doc);
                const result = await hajjReservation.insertOne(doc);
                res.send(result);
            } catch {
                res.status(500).send({ error: "Failed to create reservation" });
            }
        });

        // get all reservations api
        app.get("/api/hajj/reservations", verifyToken, async (req, res) => {
            const result = await hajjReservation
                .find()
                .sort({ createdAt: -1 })
                .toArray();
            res.send(result);
        });

        // patch reservation api
        app.patch("/api/hajj/reservations/:id", verifyToken, async (req, res) => {
            const { id } = req.params;


            await hajjReservation.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        agency: req.body.agency,
                        flight: req.body.flight,
                        fare: req.body.fare,
                        updatedAt: new Date(),
                        callerName: req.body.callerName
                    }
                }
            );

            

            res.send({ success: true });
        });

        // delete reservation api
        app.delete("/api/hajj/reservations/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;

                const result = await hajjReservation.deleteOne({
                    _id: new ObjectId(id)
                });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ error: "Reservation not found" });
                }

                res.send({ success: true });
            } catch (error) {
                res.status(500).send({ error: "Failed to delete reservation" });
            }
        });


        // payorder tracking api
        app.get("/api/hajj/search", verifyToken, async (req, res) => {
            const { flightNo,hl, trackingNo, payorderNo } = req.query;

            const query = {
                $or: [
                    { "flight.segments.flightNo": flightNo },
                    { "agency.hl": hl },
                    { "agency.trackingNo": trackingNo },
                    { "agency.payorderNo": payorderNo }
                ]
            };
            
            const result = await hajjReservation.find(query).toArray();
            // console.log(result);
            res.send(result);
        });


        // hajj api stats
        app.get("/api/hajj/stats", verifyToken, async (req, res) => {
            const reservations = await hajjReservation.find().toArray();

            let pilgrims = 0;
            let totalFare = 0;
            let totalReservations = reservations.length;

            const agencyMap = {};
            const fareVsPilgrim = [];

            reservations.forEach(r => {
                const p = Number(r.flight?.pilgrims || 0);
                const f = Number(r.fare?.totalFare || 0);

                pilgrims += p;
                totalFare += f;

                // agency wise pilgrims
                agencyMap[r.agency?.name] =
                    (agencyMap[r.agency?.name] || 0) + p;

                fareVsPilgrim.push({
                    agency: r.agency?.name,
                    pilgrims: p,
                    fare: f
                });
            });

            const topAgencies = Object.entries(agencyMap)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 5);

            const avgFarePerPilgrim =
                pilgrims > 0 ? Math.round(totalFare / pilgrims) : 0;

            res.send({
                pilgrims,
                totalFare,
                totalReservations,
                avgFarePerPilgrim,
                topAgencies,
                fareVsPilgrim
            });
        });









    }
    finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }

}
run().catch(console.dir);


/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
