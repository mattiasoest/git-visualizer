package app.gitvisualizer.events.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpResponse;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import app.gitvisualizer.config.GitHubApiProperties;

class GitHubEventsClientTest {

	private MockRestServiceServer server;
	private GitHubEventsClient client;

	@BeforeEach
	void setUp() {
		GitHubApiProperties properties = new GitHubApiProperties(
				"https://api.github.com",
				"/events",
				"",
				100,
				60,
				true,
				60);

		RestClient.Builder builder = RestClient.builder()
				.baseUrl(properties.baseUrl())
				.defaultHeader("Accept", "application/vnd.github+json")
				.defaultHeader("X-GitHub-Api-Version", "2026-03-10");

		server = MockRestServiceServer.bindTo(builder).build();
		RestClient restClient = builder.build();
		client = new GitHubEventsClient(restClient, properties);
	}

	@Test
	void storesEtagAndSendsIfNoneMatchOnNextRequest() {
		String body = """
				[
				  {
				    "id": "1",
				    "type": "WatchEvent",
				    "actor": {"id": 1, "login": "octocat", "avatar_url": "https://example/avatar"},
				    "repo": {"id": 2, "name": "octocat/Hello-World", "url": "https://api.github.com/repos/octocat/Hello-World"},
				    "payload": {"action": "started"},
				    "public": true,
				    "created_at": "2026-06-13T12:00:00Z"
				  }
				]
				""";

		server.expect(requestTo("https://api.github.com/events?per_page=100"))
				.andRespond(request -> {
					MockClientHttpResponse response = new MockClientHttpResponse(
							body.getBytes(StandardCharsets.UTF_8),
							HttpStatus.OK);
					response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
					response.getHeaders().add("ETag", "\"abc123\"");
					response.getHeaders().add("X-Poll-Interval", "90");
					return response;
				});

		server.expect(requestTo("https://api.github.com/events?per_page=100"))
				.andExpect(header("If-None-Match", "\"abc123\""))
				.andRespond(request -> {
					MockClientHttpResponse response = new MockClientHttpResponse(new byte[0], HttpStatus.NOT_MODIFIED);
					response.getHeaders().add("X-Poll-Interval", "120");
					return response;
				});

		GitHubEventsResponse first = client.fetchEvents();
		assertThat(first.notModified()).isFalse();
		assertThat(first.events()).hasSize(1);
		assertThat(first.pollIntervalSeconds()).isEqualTo(90);

		GitHubEventsResponse second = client.fetchEvents();
		assertThat(second.notModified()).isTrue();
		assertThat(second.pollIntervalSeconds()).isEqualTo(120);

		server.verify();
	}
}
