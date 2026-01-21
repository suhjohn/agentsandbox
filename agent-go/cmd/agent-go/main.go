package main

import (
	"fmt"
	"os"

	openvscodeproxy "agent-go/internal/openvscodeproxy"
	"agent-go/internal/server"
)

func main() {
	if err := runMain(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "agent-go: %v\n", err)
		os.Exit(1)
	}
}

func runMain(args []string) error {
	if len(args) == 0 {
		return server.RunServe(nil)
	}
	switch args[0] {
	case "serve":
		return server.RunServe(args[1:])
	case "openvscode-proxy":
		return openvscodeproxy.Run(args[1:])
	case "help", "--help", "-h":
		printUsage()
		return nil
	default:
		return server.RunServe(args)
	}
}

func printUsage() {
	fmt.Println(`agent-go

Usage:
  agent-go serve [flags]
  agent-go openvscode-proxy [flags]

Commands:
  serve             Run Go server implementing agent APIs.
  openvscode-proxy  Run OpenVSCode reverse proxy.

If no command is provided, runs 'serve'.`)
}
