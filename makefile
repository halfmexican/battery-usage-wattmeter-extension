install:
	gnome-extensions pack --force
	gnome-extensions install battery-usage-wattmeter@halfmexicanhalfamazing.gmail.com.shell-extension.zip --force
	rm battery-usage-wattmeter@halfmexicanhalfamazing.gmail.com.shell-extension.zip

build:
	gnome-extensions pack --force

