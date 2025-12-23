const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();


/* =========================
   MIDDLEWARE
========================= */

app.use(cors({
    origin: ["http://localhost:5173"],
    credentials: true,
}));
app.use(express.json());

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


        /* =========================
            CREATE BOOKING
        ========================= */

        app.post("/api/bookings", async (req, res) => {
            try {

                const booking = {
                    agency: req.body.agency, // name, contactPerson, phone, address

                    flight: {
                        segments: req.body.flight.segments, // array of routes
                        passengers: req.body.flight.passengers,
                        capacity: req.body.flight.capacity,
                        pnr: req.body.flight.PNR,
                    },

                    fare: req.body.fare, // perPassenger, totalFare

                    payment: {
                        paidAmount: req.body.payment?.paidAmount || 0,
                        dueAmount: req.body.payment?.dueAmount || req.body.fare.totalFare,
                        status: req.body.payment?.status || "pending",
                        history: []
                    },

                    createdAt: new Date()
                };
                console.log(booking);

                // const result = await bookings.insertOne(booking);
                // res.send(result);

            } catch (error) {
                res.status(500).send({ error: "Failed to create booking" });
            }
        });

        /* =========================
           GET ALL BOOKINGS
        ========================= */

        app.get("/api/bookings", async (req, res) => {

            const result = await bookings.find().sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        /* =========================
           SEARCH BY DEPARTURE DATE
        ========================= */

        app.get("/api/bookings/by-date", async (req, res) => {
            const { date } = req.query;


            const result = await bookings.find({
                "flight.segments.0.date": date
            }).sort({ createdAt: -1 }).toArray();

            res.send(result);
        });

        /* =========================
           SEARCH BY DATE + AGENCY
        ========================= */

        app.get("/api/bookings/search", async (req, res) => {
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

        app.patch("/api/bookings/:id/payment", async (req, res) => {
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


        /* =========================
   CREATE TOPUP (CREDIT / DEBIT)
========================= */
        app.post("/api/topups", async (req, res) => {
            try {


                const {
                    type,
                    date,
                    time,
                    amount,
                    pnr,
                    description
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
                    createdAt: new Date()
                };

                const result = await topups.insertOne(doc);
                res.send({ success: true, insertedId: result.insertedId });

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
        });

        /* =========================
           GET TOPUP LEDGER
        ========================= */
        app.get("/api/topups", async (req, res) => {
            try {


                const topup = await topups
                    .find()
                    .sort({createdAt: -1})
                    .toArray();

                res.send(topup);

            } catch (err) {
                res.status(500).send({ error: err.message });
            }
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
