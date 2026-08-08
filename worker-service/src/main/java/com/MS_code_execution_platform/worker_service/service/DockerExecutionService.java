package com.MS_code_execution_platform.worker_service.service;

import com.github.dockerjava.api.DockerClient;
import com.github.dockerjava.api.command.CreateContainerResponse;
import com.github.dockerjava.api.exception.NotFoundException;
import com.github.dockerjava.api.model.Bind;
import com.github.dockerjava.api.model.Frame;
import com.github.dockerjava.api.model.HostConfig;
import com.github.dockerjava.api.model.Volume;
import com.github.dockerjava.core.DefaultDockerClientConfig;
import com.github.dockerjava.core.DockerClientImpl;
import com.github.dockerjava.zerodep.ZerodepDockerHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.TimeUnit;

@Service
public class DockerExecutionService {

    private final DockerClient dockerClient;

    // scratchVolume/scratchDir are blank/unused for local/non-Docker Windows
    // dev (see below), set once running in docker-compose.
    private final String scratchVolume;
    private final String scratchDir;

    // Hardcoded to the Windows named pipe used to previously mean this only
    // ever worked running the JVM directly on a Windows host. Inside this
    // service's own (Linux) container, that pipe doesn't exist - the actual
    // Docker socket is bind-mounted at /var/run/docker.sock instead (see
    // docker-compose.yml's worker-service volumes, same mount
    // worker-service-go uses). DOCKER_HOST lets docker-compose point this at
    // the mounted socket while keeping the npipe default for local/non-Docker
    // development on Windows.
    public DockerExecutionService(
            @Value("${docker.host}") String dockerHost,
            @Value("${worker.scratch-volume}") String scratchVolume,
            @Value("${worker.scratch-dir}") String scratchDir) {

        this.scratchVolume = scratchVolume;
        this.scratchDir = scratchDir;

        DefaultDockerClientConfig config =
                DefaultDockerClientConfig.createDefaultConfigBuilder()
                        .withDockerHost(dockerHost)
                        .build();

        ZerodepDockerHttpClient httpClient =
                new ZerodepDockerHttpClient.Builder()
                        .dockerHost(config.getDockerHost())
                        .build();

        this.dockerClient =
                DockerClientImpl.getInstance(config, httpClient);
    }

    public String execute(String directory,
                          String image,
                          String command) throws Exception {

        // Only pull if the image isn't already present locally. An
        // unconditional pull works for every public image (python, gcc,
        // eclipse-temurin, ...) but hard-fails for locally-built-only
        // images like platform/node-typescript (see
        // infra/sandbox-images/node-typescript) - Docker Hub has no such
        // repository, so `pullImageCmd` 404s even though the image already
        // exists in the local Docker daemon this worker talks to.
        try {
            dockerClient.inspectImageCmd(image).exec();
        } catch (NotFoundException e) {
            dockerClient.pullImageCmd(image).start().awaitCompletion();
        }

        String linuxPath = directory.replace("\\", "/");

        // This worker only ever talks to the HOST's Docker daemon (via the
        // mounted docker.sock) to launch this sibling container - it does
        // NOT run code inside its own container. A plain host-path bind
        // using this container's own filesystem view of `directory` would
        // resolve against the HOST's filesystem and mount nothing/empty,
        // since that path only exists inside this container (same failure
        // mode worker-service-go hit - see its sandbox.go for the full
        // writeup). When scratchVolume is set, `directory` (e.g.
        // "/scratch/submission_18") is a path inside a NAMED VOLUME that's
        // ALSO mounted into this worker's own container at scratchDir (e.g.
        // "/scratch" - see docker-compose.yml) - binding that SAME volume by
        // NAME (not path) into the sibling container at that SAME mount
        // point makes `directory` resolve to the identical, already-written
        // files on both sides. Unset (plain local/non-Docker Windows dev,
        // where this JVM and Docker Desktop share the same real filesystem)
        // keeps the original per-submission host-path bind unchanged.
        Bind bind;
        String workingDir;
        if (scratchVolume != null && !scratchVolume.isBlank()) {
            bind = new Bind(scratchVolume, new Volume(scratchDir));
            workingDir = linuxPath;
        } else {
            bind = new Bind(linuxPath, new Volume("/app"));
            workingDir = "/app";
        }

        CreateContainerResponse container =
                dockerClient.createContainerCmd(image)
                        .withHostConfig(
                                HostConfig.newHostConfig()
                                        .withBinds(bind)
                        )
                        .withWorkingDir(workingDir)
                        .withCmd("sh", "-c", command)
                        .exec();

        String containerId = container.getId();

        dockerClient.startContainerCmd(containerId).exec();

        // ✅ WAIT FOR CONTAINER TO FINISH
        dockerClient.waitContainerCmd(containerId)
                .start()
                .awaitStatusCode();

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        dockerClient.logContainerCmd(containerId)
                .withStdOut(true)
                .withStdErr(true)
                .exec(new com.github.dockerjava.api.async.ResultCallback.Adapter<Frame>() {
                    @Override
                    public void onNext(Frame frame) {
                        try {
                            outputStream.write(frame.getPayload());
                        } catch (Exception ignored) {}
                    }
                })
                .awaitCompletion();

        dockerClient.removeContainerCmd(containerId)
                .withForce(true)
                .exec();

        String result = outputStream.toString();
        System.out.println("CONTAINER RAW OUTPUT: >>>" + result + "<<<");

        return result.trim();
    }

}