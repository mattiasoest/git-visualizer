package visualizer.github.github;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestClient;

import visualizer.github.config.GitHubApiProperties;
import visualizer.github.github.model.GitHubEvent;

@Component
public class GitHubEventsClient {

	private static final Logger log = LoggerFactory.getLogger(GitHubEventsClient.class);

	private final RestClient restClient;
	private final GitHubApiProperties properties;
	private final AtomicReference<String> etag = new AtomicReference<>();

	public GitHubEventsClient(RestClient gitHubRestClient, GitHubApiProperties properties) {
		this.restClient = gitHubRestClient;
		this.properties = properties;
	}

	public GitHubEventsResponse fetchEvents() {
		try {
			return restClient.get()
					.uri(uriBuilder -> uriBuilder
							.path(properties.eventsPath())
							.queryParam("per_page", properties.perPage())
							.build())
					.headers(headers -> {
						String currentEtag = etag.get();
						if (currentEtag != null) {
							headers.set("If-None-Match", currentEtag);
						}
					})
					.exchange((request, response) -> {
						int pollInterval = parsePollInterval(response.getHeaders().getFirst("X-Poll-Interval"));
						String rateLimitRemaining = response.getHeaders().getFirst("X-RateLimit-Remaining");
						if (rateLimitRemaining != null) {
							log.debug("GitHub rate limit remaining: {}", rateLimitRemaining);
						}

						if (response.getStatusCode().value() == 304) {
							return new GitHubEventsResponse(List.of(), Optional.empty(), pollInterval, true);
						}

						String newEtag = response.getHeaders().getFirst("ETag");
						if (newEtag != null) {
							etag.set(newEtag);
						}

						GitHubEvent[] events = response.bodyTo(GitHubEvent[].class);
						List<GitHubEvent> eventList = events == null ? List.of() : List.of(events);
						return new GitHubEventsResponse(eventList, Optional.ofNullable(newEtag), pollInterval, false);
					});
		}
		catch (HttpClientErrorException.Forbidden ex) {
			log.warn("GitHub API rate limit or forbidden: {}", ex.getMessage());
			throw new GitHubApiException("Rate limited or forbidden", ex, true);
		}
		catch (HttpServerErrorException ex) {
			log.warn("GitHub API server error: {}", ex.getMessage());
			throw new GitHubApiException("GitHub server error", ex, true);
		}
	}

	public void resetEtag() {
		etag.set(null);
	}

	private int parsePollInterval(String headerValue) {
		if (headerValue == null || headerValue.isBlank()) {
			return properties.minPollIntervalSeconds();
		}
		try {
			return Math.max(properties.minPollIntervalSeconds(), Integer.parseInt(headerValue.trim()));
		}
		catch (NumberFormatException ex) {
			return properties.minPollIntervalSeconds();
		}
	}

	public static class GitHubApiException extends RuntimeException {

		private final boolean retryable;

		public GitHubApiException(String message, Throwable cause, boolean retryable) {
			super(message, cause);
			this.retryable = retryable;
		}

		public boolean isRetryable() {
			return retryable;
		}
	}
}
