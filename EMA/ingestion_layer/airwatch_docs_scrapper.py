import os
import csv
import time
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from urllib.parse import urljoin

# Setup Chrome WebDriver
chrome_options = Options()
chrome_options.add_argument("--start-maximized")
service = Service(executable_path="/opt/homebrew/bin/chromedriver")
driver = webdriver.Chrome(service=service, options=chrome_options)

# Base URL with filters applied and page size set to 50 results per page
base_url = "https://docs.omnissa.com/search?groupByPub=false&labelkey=workspaceone&labelkey=workspaceone_xr_hub&labelkey=mobile_threat_defense&labelkey=workspaceone_assist&labelkey=workspaceone_hub_services&labelkey=workspaceone_admin_assistant&labelkey=workspaceone_launcher&labelkey=workspaceone_tunnel&labelkey=workspaceone_uem&labelkey=workspaceone_boxer&labelkey=workspaceone_content&labelkey=workspaceone_web&labelkey=workspaceone_send&labelkey=intelligent_hub&labelkey=remotehelp&labelkey=platform&labelkey=freestyle_orchestrator&labelkey=prod_docs&labelkey=&rpp=50&sort.field=score&sort.value=desc"

# Prepare directories for saving data
os.makedirs("omnissa_images", exist_ok=True)
csv_file_path = "omnissa_articles.csv"

# Open CSV file for writing
csv_file = open(csv_file_path, mode='w', newline='', encoding='utf-8')
csv_writer = csv.writer(csv_file)
csv_writer.writerow(["Title", "URL", "Content", "Image Links"])

# Set to track scraped URLs
scraped_urls = set()

driver.get(base_url)
wait = WebDriverWait(driver, 15)

def extract_articles():
    """Extracts valid article links using a more specific XPath selector."""
    try:
        # Wait for results to load and target links using XPath
        wait.until(EC.presence_of_element_located((By.XPATH, "//li[contains(@class, 'zDocsSearchResultItem')]//h2/a")))
        
        # Extracting article links specifically from search result items
        articles = driver.find_elements(By.XPATH, "//li[contains(@class, 'zDocsSearchResultItem')]//h2/a")
        
        # Extract links while ignoring lifecycle and library links
        all_links = [article.get_attribute("href") for article in articles if article.get_attribute("href")]
        filtered_links = [link for link in all_links if 'lifecyclematrix' not in link and '/bundle/' in link]

        # Remove duplicates
        filtered_links = [link for link in filtered_links if link not in scraped_urls]
        print(f"\n🔗 Total Extracted URLs (After Filtering): {len(filtered_links)}")
        for link in filtered_links:
            print(f"  - {link}")

        return filtered_links
    except Exception as e:
        print(f"❌ Error extracting articles: {e}")
        return []

def download_image(img_url):
    """Downloads an image and saves it locally."""
    try:
        if img_url.startswith("/"):
            img_url = urljoin(base_url, img_url)
        response = requests.get(img_url, stream=True)
        if response.status_code == 200:
            img_name = os.path.join("omnissa_images", os.path.basename(img_url.split("?")[0]))
            with open(img_name, 'wb') as img_file:
                for chunk in response.iter_content(1024):
                    img_file.write(chunk)
            print(f"📸 Image saved: {img_name}")
            return img_name
        else:
            print(f"❌ Failed to download image: {img_url}")
            return None
    except Exception as e:
        print(f"❌ Error downloading image {img_url}: {e}")
        return None

def scrape_article(url):
    """Scrapes the content of a single article page."""
    driver.get(url)
    print(f"\n🌐 Visiting: {url}")
    time.sleep(3)
    try:
        # Ignore invalid pages
        if "lifecyclematrix" in driver.current_url or "search?" in driver.current_url:
            print("⚠️ Skipping lifecycle matrix or invalid page...")
            return None

        title = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1.css-g931ng"))).text
        content_element = driver.find_element(By.CSS_SELECTOR, "article.markdown")
        content = content_element.text

        # Scrape and download images
        images = driver.find_elements(By.CSS_SELECTOR, "article.markdown img")
        image_links = [img.get_attribute('src') for img in images if img.get_attribute('src')]
        downloaded_images = [download_image(img) for img in image_links]

        # Avoid duplicates
        if url not in scraped_urls:
            csv_writer.writerow([title, url, content, ", ".join(downloaded_images)])
            scraped_urls.add(url)
            print(f"✅ Scraped: {title}")
        else:
            print(f"⚠️ Skipping duplicate URL: {url}")

    except Exception as e:
        print(f"❌ Error scraping {url}: {e}")
        return None

def click_next_page():
    """Clicks the next page button if available."""
    try:
        next_button = driver.find_element(By.XPATH, "//a[contains(@class, 'zDocsPaginationNext')]")
        driver.execute_script("arguments[0].click();", next_button)
        print("➡️ Moving to the next page...")
        time.sleep(5)
        return True
    except Exception as e:
        print("✅ Reached the last page or no next button available.")
        return False

# Main scraping loop with page tracking
page_number = 1

while True:
    print(f"\n🚀 Scraping Page {page_number}...")
    driver.get(f"{base_url}&page={page_number}")
    article_links = extract_articles()
    if not article_links:
        print(f"No articles found on page {page_number}.")
        break

    # Scrape each article link
    for link in article_links:
        scrape_article(link)

    # Move to next page by increasing page number directly
    page_number += 1

# Close CSV and browser
csv_file.close()
driver.quit()

print(f"\n🎯 Scraping complete! Total articles scraped: {len(scraped_urls)}")