## Python 3.11 Environment Setup for HuggingFace Adapters

Some versions of the HuggingFace Adapters library are not compatible with Python 3.12.
This results in installation failures or runtime errors when loading adapter-based models (e.g., AutoAdapterModel, SPECTER2).

To ensure full compatibility, it is recommended to use Python 3.11 and create a dedicated virtual environment.
This README explains how to install Python 3.11, create the environment, and set it up for VS Code/Jupyter.

### Install Python 3.11 (Ubuntu)

On Ubuntu, Python 3.11 must be installed via the deadsnakes PPA:

```
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install python3.11 python3.11-venv
```

Verify installation:
```
python3.11 --version
```
### Create the Python 3.11 virtual environment

Navigate to the project folder:
```
cd /path/to/scientilla_ai
```

Create the environment:
```
python3.11 -m venv myEnv311
```
Activate it:
```
source myEnv311/bin/activate
```

Check the interpreter:
```
python --version
```
Should display Python 3.11.x

### Install required packages

With the environment activated:
```
pip install --upgrade pip
pip install ipykernel
pip install sentence-transformers scikit-learn numpy pandas psycopg2-binary
```
### Register the environment as a Jupyter kernel (for VS Code)

Still inside the environment:
```
python -m ipykernel install --user --name myEnv311 --display-name "myEnv (Python 3.11)
```


This makes the environment selectable in VS Code notebooks.

### Select the kernel in VS Code

- Open your .ipynb file

- Click the kernel selector in the top-right corner

- Choose myEnv (Python 3.11)