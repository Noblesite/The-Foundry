
from fine_tuning_layer.qlora_fine_tuner import QLoRAFineTuner
from utilities.path_manager import PathManager


path_manager = PathManager()


train_dataset_path = path_manager.get_path("WSO_TRAIN_DS")
val_dataset_path = path_manager.get_path("WSO_VAL_DS")


def model_time():
    the_train = QLoRAFineTuner(train_dataset_path=train_dataset_path, val_dataset_path=val_dataset_path)
    the_train.train()


if __name__ == "__main__":

    model_time()


