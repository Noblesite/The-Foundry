import csv
import re
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def clean_text(text):
    """Cleans the scraped text by removing extra whitespace and special characters."""
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'[^\x00-\x7F]+', ' ', text)  
    return text

# Set up Selenium with a polite user-agent and visible browser for debugging
chrome_options = Options()
chrome_options.add_argument("user-agent=Mozilla/5.0 (compatible; MyScraper/1.0; +http://example.com/contact)")
driver = webdriver.Chrome(options=chrome_options)

# Open the website
url = "https://kb.omnissa.com/s/global-search/%40uri#t=MoreContent&sort=relevancy&numberOfResults=100&f:@commonproduct=[Workspace%20ONE]&f:@commonlanguage=[English]"
driver.get(url)

# Wait for dynamic content loading
wait = WebDriverWait(driver, 30)
wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))

# Prepare CSV file for saving results
csv_file = "omnissa_articles.csv"
file = open(csv_file, mode='w', newline='', encoding='utf-8')
writer = csv.writer(file)
writer.writerow(["Title", "Link", "Content"])

# Keep track of the current page number
page_number = 1

while True:
    print(f"Scraping Page {page_number}...")
    
    # Wait to ensure content loads
    time.sleep(5)

    # Extract articles on the current page
    articles = driver.find_elements(By.XPATH, "//a[contains(@href, '/s/article/')]")
    print(f"Number of articles found on page {page_number}: {len(articles)}")

    # Scrape articles
    for article in articles:
        title = article.text.strip()
        link = article.get_attribute('href')

        if title and link:
            driver.execute_script(f"window.open('{link}', '_blank');")
            driver.switch_to.window(driver.window_handles[-1])
            time.sleep(5)

            try:
                # Wait for the content to load in the article view
                wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                content_element = driver.find_element(By.TAG_NAME, "body")
                content = clean_text(content_element.text)
                if len(content) > 100:
                    writer.writerow([title, link, content])
                    print(f"✔️ Saved: {title}")
                else:
                    print(f"⚠️ Skipped: {title} (Content too short)")
            except Exception as e:
                print(f"❌ Error scraping {title}: {e}")

            driver.close()
            driver.switch_to.window(driver.window_handles[0])

    # Attempt to move to the next page using the correct XPath
    try:
        next_button = driver.find_element(By.XPATH, "//li[contains(@class, 'coveo-pager-next')]")
        driver.execute_script("arguments[0].click();", next_button)
        page_number += 1
    except:
        print("No more pages left to scrape.")
        break

# Close the CSV file after all pages are scraped
file.close()
input("Press Enter to close the browser...")
driver.quit()
print(f"\nScraped data saved to {csv_file}")