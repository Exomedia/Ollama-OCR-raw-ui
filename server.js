import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ollamaOCR, DEFAULT_OCR_SYSTEM_PROMPT } from 'ollama-ocr';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read configuration from environment variables
const config = {
    port: process.env.PORT || 3000,
    fileLimit: parseInt(process.env.FILE_LIMIT, 10) || 5,
    uploadDir: process.env.UPLOAD_DIR || 'uploads', // Use environment variable or default to 'uploads'
    downloadDir: process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads'), // Use environment variable or default to 'downloads'
};

// Validate environment variables (optional)
if (!process.env.FILE_LIMIT || isNaN(config.fileLimit)) {
    throw new Error('FILE_LIMIT is not properly set in .env');
}

const app = express();

const ensureDirectoryExistence = async (filePath) => {
    const dirname = path.dirname(filePath);
    await fs.mkdir(dirname, { recursive: true });
};

const storage = multer.diskStorage({
    destination: config.uploadDir, // Use the configured upload directory
    filename: (req, file, cb) => {
        const extname = path.extname(file.originalname).toLowerCase();
        const randomName = `${Date.now()}-${Math.random().toString(36).substring(2)}${extname}`;
        cb(null, randomName);
    },
});

const upload = multer({
    storage,
    limits: { files: config.fileLimit, fileSize: 10 * 1024 * 1024 }, // Max file size 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png/;
        const isFileTypeValid = allowedTypes.test(path.extname(file.originalname).toLowerCase()) && 
                                allowedTypes.test(file.mimetype);

        isFileTypeValid ? cb(null, true) : cb(new Error('Unsupported file type'));
    },
}).array('imageFiles', config.fileLimit); // Limit to number of files set in config

const generateDocx = async (texts, outputPath) => {
    const paragraphs = texts.map(text => new Paragraph({ children: [new TextRun(text)] }));
    const doc = new Document({
        sections: [{ children: paragraphs }],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
};

// Endpoint to fetch configuration (for frontend)
app.get('/config', (req, res) => {
    res.json({ fileLimit: config.fileLimit });
});

// Endpoint to process OCR
app.post('/process-ocr', async (req, res, next) => {
    upload(req, res, async (err) => {
        if (err) return next(err);

        try {
            const files = req.files;
            const texts = await Promise.all(files.map(async (file) => {
                const text = await ollamaOCR({ filePath: file.path, systemPrompt: DEFAULT_OCR_SYSTEM_PROMPT });
                await fs.unlink(file.path); // Clean up uploaded file
                return text;
            }));

            const outputFileName = `output-${Date.now()}.docx`;
            const outputPath = path.join(config.downloadDir, outputFileName); // Use the configured download directory
            await ensureDirectoryExistence(outputPath);
            await generateDocx(texts, outputPath);

            res.json({ fileUrl: `/downloads/${outputFileName}` });
        } catch (error) {
            next(error); // Pass errors to the error handler
        }
    });
});

// Serve static files for download
app.use('/downloads', express.static(config.downloadDir, {
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

// Serve static files for frontend (HTML, JS, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Start the server
app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
});
