import ray
import time
import zstandard as zstd  # ✅ Safe to import globally
from pathlib import Path
import io  # ✅ Required for streaming decompression

ray.init(address="auto", ignore_reinit_error=True)

@ray.remote(num_cpus=8)
class DistributeFilesWorker:
    def __init__(self):
        """Initialize the worker with a PathManager instance."""
        from utilities.path_manager import PathManager  
        from utilities.logger import get_logger  

        self.path_manager = PathManager()
        self.logger = get_logger("DistributeFilesWorker")

    def process_file(self, file_bytes: bytes, filename: str, path_manager_directory: str):
        """Worker receives compressed raw bytes, logs data rate, decompresses if needed, and saves locally."""

        tmp = self.path_manager.get_path(path_manager_directory)
        self.logger.debug(f"path_manager_directory Value: {tmp}")

        try:
            save_dir = Path(tmp)
            save_dir.mkdir(parents=True, exist_ok=True)

            file_size_mb = len(file_bytes) / (1024 * 1024)  # Convert bytes to MB
            self.logger.info(f"📥 Receiving {filename} ({file_size_mb:.2f} MB)...")

            start_time = time.time()

            if filename.endswith(".zst"):
                decompressed_filename = filename[:-4]
                decompressed_path = save_dir / decompressed_filename
                self.logger.info(f"📦 Detected compressed file: {filename}. Decompressing...")

                try:
                    decompressor = zstd.ZstdDecompressor()
                    with decompressed_path.open("wb") as out_file, io.BytesIO(file_bytes) as compressed_stream:
                        with decompressor.stream_reader(compressed_stream) as reader:
                            while chunk := reader.read(16384):
                                out_file.write(chunk)

                    self.logger.info(f"✅ File decompressed and saved as {decompressed_filename}")

                    total_time = time.time() - start_time
                    avg_speed = (file_size_mb / total_time) if total_time > 0 else 0
                    self.logger.info(f"🚀 Average Decompression Speed: {avg_speed:.2f} MB/s | Total Time: {total_time:.2f}s")

                    return f"✅ File {decompressed_filename} saved at {decompressed_path}"

                except Exception as e:
                    self.logger.error(f"❌ Decompression failed for {filename}: {e}")
                    return f"❌ Error decompressing {filename}: {str(e)}"

            else:
                save_path = save_dir / filename
                with save_path.open("wb") as f:
                    f.write(file_bytes)

                self.logger.info(f"✅ File {filename} saved at {save_path}")
                return f"✅ File {filename} saved at {save_path}"

        except Exception as e:
            self.logger.error(f"❌ Error saving {filename}: {e}")
            return f"❌ Error saving {filename}: {str(e)}"