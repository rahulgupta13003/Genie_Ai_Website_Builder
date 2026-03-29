import "dotenv/config";
import express, { Request, Response } from 'express';
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import userRouter from "./routes/userRoutes.js";
import projectRouter from "./routes/projectRoutes.js";

const app = express();

const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
    origin: process.env.TRUSTED_ORIGINS?.split(',') || ['http://localhost:5173'],
    credentials: true,
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json({limit: '50mb'}));

// Auth routes
app.use('/api/auth', toNodeHandler(auth));

app.get('/', (req: Request, res: Response) => {
    res.send('Server is Live!');
});

app.use('/api/user', userRouter);
app.use('/api/project',projectRouter);


app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});