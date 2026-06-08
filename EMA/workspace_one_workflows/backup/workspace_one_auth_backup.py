#!/usr/bin/env python3
import os
import base64
import tempfile
import subprocess
from dotenv import load_dotenv
from urllib.parse import urlparse
from cryptography.hazmat.primitives.serialization import pkcs12, Encoding, PrivateFormat, NoEncryption
from cryptography.hazmat.backends import default_backend
from utilities.logger import get_logger

class WorkspaceOneAuth:
    """
    Handles Workspace One authentication by generating the CMSURL header value.
    """

    def __init__(self):
        # Load environment variables.
        load_dotenv()
        self.logger = get_logger(__name__)

    def get_cmsurl_header(self, url: str):
        """
        Returns the CMSURL header value for the given URL.
        """
        self._get_enviroment_certificate(url)
        p12_cert_path = self.cert_path
        cert_password = self.cert_pw

        # Load private key and certificate from the PKCS#12 file.
        private_key, certificate = self._load_p12_cert(p12_cert_path, cert_password)
        if not private_key or not certificate:
            self.logger.error("❌ Failed to load certificate. Aborting CMSURL header generation.")
            return None

        # Compute canonical URL as the absolute path only (exclude query parameters).
        parsed_url = urlparse(url)
        canonical_path = parsed_url.path  # Note: do NOT include the query string.
        self.logger.debug(f"🔒 Signing canonical URL: {canonical_path}")

        # Generate a CMS/PKCS#7 signature container.
        cms_container = self._sign_data(private_key, certificate, canonical_path)
        if cms_container is None:
            self.logger.error("❌ Signing failed. Unable to generate CMSURL header.")
            return None

        # Base64 encode the CMS container and prefix it.
        encoded_signature = base64.b64encode(cms_container).decode()
        header_value = f"CMSURL`1 {encoded_signature}"
        self.logger.info("✅ CMSURL header successfully generated.")
        return header_value

    def _get_enviroment_certificate(self, url: str):
        """
        Extracts the environment from the URL and sets the certificate path and password.
        """
        # Example: for "https://as223.awmdm.com/api/..." the environment is "as223".
        try:
            enviroment = url.split("https://")[1].split(".awmdm.com")[0]
        except IndexError:
            self.logger.error("❌ Invalid URL format.")
            enviroment = ""

        # Map environment to certificate environment variables.
        env_map = {
            "as88": ("CN88_CERT_PATH", "CN88_CERT_PW"),
            "as223": ("CN223_CERT_PATH", "CN223_CERT_PW"),
            "as885": ("CN885_CERT_PATH", "CN885_CERT_PW"),
            "as908": ("CN908_CERT_PATH", "CN908_CERT_PW"),
        }

        cert_path_key, cert_pw_key = env_map.get(enviroment, ("CN223_CERT_PATH", "CN223_CERT_PW"))
        if enviroment not in env_map:
            self.logger.warning(f"⚠️ Unknown environment '{enviroment}', defaulting to CN223")

        self.cert_path = os.getenv(cert_path_key)
        self.cert_pw = os.getenv(cert_pw_key)

    def _load_p12_cert(self, p12_path, password):
        """
        Load the PKCS#12 certificate file (.p12) and extract the private key and certificate.
        """
        try:
            with open(p12_path, "rb") as f:
                p12_data = f.read()

            private_key, certificate, additional_certs = pkcs12.load_key_and_certificates(
                p12_data, password.encode(), backend=default_backend()
            )

            self.logger.info("✅ Successfully loaded PKCS#12 certificate.")
            return private_key, certificate

        except Exception as e:
            self.logger.error(f"❌ Error loading PKCS#12 file: {e}")
            return None, None

    def _sign_data(self, private_key, certificate, data):
        """
        Generate a CMS/PKCS#7 signature container for the given data using OpenSSL.
        This method writes the data, private key, and certificate to temporary files
        and then invokes the OpenSSL CMS signing command to create a DER-encoded container.
        The resulting CMS container is a detached signature (the signed data is not embedded).
        """
        try:
            # Write the canonical URL (data to sign) to a temporary file.
            with tempfile.NamedTemporaryFile(delete=False) as data_file:
                data_file.write(data.encode("utf-8"))
                data_file_path = data_file.name

            # Write the private key to a temporary PEM file.
            with tempfile.NamedTemporaryFile(delete=False) as key_file:
                key_pem = private_key.private_bytes(
                    encoding=Encoding.PEM,
                    format=PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=NoEncryption()
                )
                key_file.write(key_pem)
                key_file_path = key_file.name

            # Write the certificate to a temporary PEM file.
            with tempfile.NamedTemporaryFile(delete=False) as cert_file:
                cert_pem = certificate.public_bytes(encoding=Encoding.PEM)
                cert_file.write(cert_pem)
                cert_file_path = cert_file.name

            # Prepare a temporary file for the CMS output.
            with tempfile.NamedTemporaryFile(delete=False) as out_file:
                out_file_path = out_file.name

            # Build the OpenSSL CMS sign command.
            # -binary ensures binary output; -md sha512 forces the use of SHA512.
            cmd = [
                "openssl", "cms", "-sign",
                "-in", data_file_path,
                "-signer", cert_file_path,
                "-inkey", key_file_path,
                "-out", out_file_path,
                "-outform", "DER",
                "-binary",
                "-md", "sha512"
            ]

            result = subprocess.run(cmd, capture_output=True)
            if result.returncode != 0:
                self.logger.error("❌ Error generating CMS signature: " + result.stderr.decode())
                # Clean up temporary files.
                os.remove(data_file_path)
                os.remove(key_file_path)
                os.remove(cert_file_path)
                os.remove(out_file_path)
                return None

            with open(out_file_path, "rb") as f:
                cms_data = f.read()

            # Cleanup temporary files.
            os.remove(data_file_path)
            os.remove(key_file_path)
            os.remove(cert_file_path)
            os.remove(out_file_path)

            self.logger.debug("✅ CMS signature generated successfully.")
            return cms_data

        except Exception as e:
            self.logger.error(f"❌ Exception in CMS signing: {e}")
            return None