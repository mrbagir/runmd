.PHONY: build test css run

build:
	go build -o runmd .

test:
	go vet ./... && go test -race ./...
	node --test tests/frontend/*.test.mjs

run: build
	./runmd

# Regenerates the pre-built Tailwind stylesheet (needs Node/npm; the app itself does not).
css:
	cd tools/tailwind && npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i input.css -o ../../static/vendor/tailwind.css --minify
