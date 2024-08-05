#!/bin/bash

# Define the extension name and zip file
extension_name="battery-usage-wattmeter@halfmexicanhalfamazing.gmail.com"
extension_zip="${extension_name}.shell-extension.zip"
extension_dir="$HOME/.local/share/gnome-shell/extensions/$extension_name"

# Pack the extension
gnome-extensions pack --force

# Install the extension
gnome-extensions install "$extension_zip" --force

# Remove the zip file
rm "$extension_zip"

# Check if the extension folder exists
if [ -d "$extension_dir" ]; then
    echo "Extension installed successfully."
else
    echo "Extension installation failed."
fi


