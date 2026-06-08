from utilities.logger import get_logger
from utilities.path_manager import PathManager
from data_cleaning.jsonl_consolidator import JSONLConsolidator
from data_cleaning.jsonl_structure_analyzer import JSONLStructureAnalyzer
from data_cleaning.jsonl_splitter import JSONLSplitter
from data_cleaning.jsonl_noise_detector import JSONLNoiseDetector
from data_cleaning.jsonl_deduplicator import JSONLDeduplicator
from data_cleaning.jsonl_na_fixer import MetadataCleaner
from data_cleaning.jsonl_dataset_preparer import JSONLDatasetPreparer
from data_cleaning.jsonl_malformed_cleaner import MalformedJSONLCleaner
from data_cleaning.dataset_tab_new_line_cleaner import DatasetTabNewLineCleaner
from utilities.logger import get_logger
import json


path_manager = PathManager()
logger = get_logger("Data Cleaning Pipeline")


the_one_file_path = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_full_filitered_dataset.jsonl" 
wso_context = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_full_cleaned_none_mal.jsonl" 
wso_full_dataset = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_full_dataset.jsonl" 
wso_train_dataset = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_train_dataset.jsonl" 
wso_val_dataset = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_val_dataset.jsonl" 
wso_train_dict = path_manager.get_path("WSO_TRAIN_DS")
wso_val_dict = path_manager.get_path("WSO_VAL_DS")
wso_tab_new_line_removed = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_tab_new_line_removed.jsonl" 

wso_filitered_files_ds = path_manager.get_path("WSO_DISTRIBUTED_DATA_SET_DIR") + "/filitered/" 
wso_filitered_ds = path_manager.get_path("CLEAN_JSONL_DATA") + "/wso_full_filitered_dataset.jsonl" 



def analyze_dataset_structure():
    jsonl_structure_analyzer = JSONLStructureAnalyzer(wso_context)
    jsonl_structure_analyzer.analyze_structure()
    jsonl_structure_analyzer.report()

def check_dataset_noise():
    detector = JSONLNoiseDetector(wso_context)
    detector.run_analysis()

def prep_dataset_for_training():
    preparer = JSONLDatasetPreparer(the_one_file_path, wso_train_dataset, wso_val_dataset)
    preparer.load_and_shuffle()
    preparer.split_dataset()

def split_dataset_into_smaller_chunks(whole_dataset, dataset_dir):
    splitter = JSONLSplitter(whole_dataset, dataset_dir)
    splitter.split()


def prnt_dataset_records(print_number=1000):
    with open(wso_context, "r") as f:
        for _ in range(print_number):  # Print first 5 records
            logger.info(json.loads(f.readline()))

def tab_new_line_filiter():
    cleaner = DatasetTabNewLineCleaner(input_file=the_one_file_path, output_file=wso_tab_new_line_removed)
    cleaner.clean_dataset()

def remove_na_from_metadata():
    cleaner = MetadataCleaner(the_one_file_path, wso_context)
    cleaner.clean()

def remove_malformed_qa_pairs():
    cleaner = MalformedJSONLCleaner(the_one_file_path, wso_context)
    cleaner.clean()


def consolidate_jsonl_files():
    consolidator = JSONLConsolidator(input_dir=wso_filitered_files_ds, output_file=wso_filitered_ds)
    consolidator.consolidate()

prep_dataset_for_training()
split_dataset_into_smaller_chunks(wso_train_dataset, wso_train_dict)
split_dataset_into_smaller_chunks(wso_val_dataset, wso_val_dict)




