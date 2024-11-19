// Import necessary libraries
const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const ftp = require('basic-ftp');
const axios = require('axios');

// FTP Configuration
const ftpConfig = {
  host: '148.251.195.32',
  user: 'sametxxxxx',
  password: 'P,,8T?sTmTeN'
};

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Endpoint to handle scraping
app.get('/scrape', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Please provide a URL to scrape.');
  }

  try {
    // Connect to browserless instance
    const browser = await puppeteer.connect({
      browserWSEndpoint: 'wss://app-browserless.8cwleg.easypanel.host/?token=6R0W53R135510',
    });

    const page = await browser.newPage();

    // Capture all network requests for resources
    const urls = new Set();
    page.on('requestfinished', (request) => {
      const url = request.url();
      const resourceType = request.resourceType();
      if (resourceType === 'stylesheet' || resourceType === 'script' || resourceType === 'image') {
        urls.add(url);
      }
    });

    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds for dynamic resources to load

    // Create a folder to store the scraped content
    const folderPath = path.join(__dirname, 'scraped_site');
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
    }

    // Save the HTML content with the original directory structure
    const parsedUrl = new URL(targetUrl);
    const htmlPath = path.join(folderPath, parsedUrl.hostname, parsedUrl.pathname, 'index.html');
    const htmlDir = path.dirname(htmlPath);
    if (!fs.existsSync(htmlDir)) {
      fs.mkdirSync(htmlDir, { recursive: true });
    }
    const htmlContent = await page.content();
    fs.writeFileSync(htmlPath, htmlContent);

    // Convert Set to Array for processing
    const allUrls = Array.from(urls);

    // Download all collected resources
    for (const fileUrl of allUrls) {
      try {
        const absoluteUrl = new URL(fileUrl, targetUrl).href;
        const response = await axios.get(absoluteUrl, { responseType: 'arraybuffer' });

        const urlPath = new URL(absoluteUrl).pathname;
        const fileName = path.basename(urlPath);
        const fileDir = path.dirname(urlPath);

        // Create the folder structure that mirrors the original website's structure
        const fullDirPath = path.join(folderPath, parsedUrl.hostname, fileDir);
        if (!fs.existsSync(fullDirPath)) {
          fs.mkdirSync(fullDirPath, { recursive: true });
        }

        // Save the file within the correct directory
        fs.writeFileSync(path.join(fullDirPath, fileName), response.data);
      } catch (error) {
        console.error(`Failed to download: ${fileUrl}`, error);
      }
    }

    // Create a ZIP file of the folder
    const zipPath = path.join(__dirname, 'scraped_site.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', async () => {
      // Upload ZIP to FTP server
      const client = new ftp.Client();
      client.ftp.verbose = true;
      try {
        await client.access(ftpConfig);
        const zipFileName = `scraped_site_${Date.now()}.zip`;
        await client.uploadFrom(zipPath, zipFileName);
        res.json({ message: 'Scraping and upload successful!', ftpUrl: `ftp://${ftpConfig.host}/${zipFileName}` });
      } catch (err) {
        console.error('Error uploading to FTP:', err);
        res.status(500).send('Failed to upload to FTP');
      } finally {
        client.close();
      }

      // Clean up files
      fs.rmSync(folderPath, { recursive: true, force: true });
      fs.unlinkSync(zipPath);
    });

    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();

    await browser.close();
  } catch (error) {
    console.error('Error during scraping:', error);
    res.status(500).send('An error occurred while scraping the site.');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
