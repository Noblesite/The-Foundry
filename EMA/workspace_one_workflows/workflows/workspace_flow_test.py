from workspace_one_workflows.mdm.mdm import MDM



if __name__ == "__main__":
    # Initialize MDM object
    mdm = MDM("cn885")

    # Create a new smart group
    device_information = mdm.extensive_search_device_details("2535")
    print(device_information)

  