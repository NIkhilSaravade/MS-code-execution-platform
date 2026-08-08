package com.MS_code_execution_platform.worker_service.service;

import com.MS_code_execution_platform.worker_service.util.FileUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CodeExecutionService {

    // One entry per supported language - adding a language is adding one
    // entry here, not a new switch case. image/sourceFilename/command are
    // all fixed strings known ahead of time (no real templating needed).
    private record LanguageRuntime(String image, String sourceFilename, String command) {}

    private static final Map<String, LanguageRuntime> REGISTRY = Map.of(
            "python", new LanguageRuntime("python:3.10", "main.py",
                    "python main.py < input.txt"),
            "java", new LanguageRuntime("eclipse-temurin:17", "Main.java",
                    "javac Main.java && java Main < input.txt"),
            // -std=c++17/-std=c11 pinned explicitly (rather than trusting
            // gcc's implicit default) to match the frontend's "C++17"/"C11"
            // language labels.
            "cpp", new LanguageRuntime("gcc:12", "main.cpp",
                    "g++ -std=c++17 main.cpp -o main && ./main < input.txt"),
            "c++", new LanguageRuntime("gcc:12", "main.cpp",
                    "g++ -std=c++17 main.cpp -o main && ./main < input.txt"),
            "c", new LanguageRuntime("gcc:12", "main.c",
                    "gcc -std=c11 main.c -o main -lm && ./main < input.txt"),
            "javascript", new LanguageRuntime("node:20-slim", "main.js",
                    "node main.js < input.txt"),
            // platform/node-typescript:20 - locally built, see
            // infra/sandbox-images/node-typescript (no official image ships
            // both Node and tsc).
            "typescript", new LanguageRuntime("platform/node-typescript:20", "main.ts",
                    "tsc --target es2016 --module commonjs main.ts && node main.js < input.txt"),
            // GOCACHE/HOME explicitly redirected - the go tool otherwise
            // wants to write its build cache under $HOME, which may not be
            // writable for whatever user this container runs as.
            "go", new LanguageRuntime("golang:1.22-alpine", "main.go",
                    "GOCACHE=/tmp HOME=/tmp GOMAXPROCS=1 GOFLAGS=-p=1 go build -o main main.go && ./main < input.txt")
    );

    private final DockerExecutionService dockerExecutionService;

    // Same value DockerExecutionService gets - see its worker.scratch-dir
    // comment. "docker-code" for local/non-Docker Windows dev (a plain
    // relative directory next to wherever the JVM runs); "/scratch" in
    // docker-compose (a named-volume mount point shared with sandbox
    // containers).
    @Value("${worker.scratch-dir}")
    private String scratchDir;

    public String execute(Long submissionId,
                          String code,
                          String language,
                          String input) {

        LanguageRuntime runtime = REGISTRY.get(language == null ? "" : language.toLowerCase());
        if (runtime == null) {
            return "Unsupported Language";
        }

        try {
            Path dir = FileUtils.createTempDirectory(scratchDir, submissionId);

            FileUtils.writeCodeFile(dir, runtime.sourceFilename(), code);
            FileUtils.writeCodeFile(dir, "input.txt", input);

            return dockerExecutionService.execute(
                    dir.toAbsolutePath().toString(),
                    runtime.image(),
                    runtime.command()
            );

        } catch (Exception e) {
            return "Execution Error: " + e.getMessage();
        }
    }
}
