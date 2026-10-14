// THROWAWAY #728 PROTOTYPE. This is a route/trip-round scan over the saved CSA
// preparation, not production code. It answers whether a round-based scan can
// match the CSA results and improve search time on exactly the same network.
#include <Rcpp.h>
#include <algorithm>
#include <cstdint>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace Rcpp;

namespace {
struct Ride { int from, to, trip; double dep, arr; };
struct Trip { int id; std::vector<Ride> rides; };
struct Walk { int from; double minutes; };
struct Rule { int type; double minimum; };
struct Label {
  double departure, arrival;
  int transfers, walks, trip;
};
struct Best {
  bool found = false;
  double duration = std::numeric_limits<double>::infinity();
  double departure = NA_REAL, arrival = NA_REAL;
  int transfers = NA_INTEGER, walks = NA_INTEGER;
};
struct Network {
  std::unordered_map<std::string, int> stop_ids, trip_ids;
  std::vector<Trip> trips;
  std::unordered_map<int, std::vector<Walk>> incoming_walks;
  std::unordered_map<std::uint64_t, Rule> rules;
  std::size_t ride_count = 0, walk_count = 0;
};

int intern(const std::string& value, std::unordered_map<std::string, int>& ids) {
  auto it = ids.find(value);
  if (it != ids.end()) return it->second;
  const int id = static_cast<int>(ids.size());
  ids.emplace(value, id);
  return id;
}

std::uint64_t pair_key(int a, int b) {
  return (static_cast<std::uint64_t>(static_cast<std::uint32_t>(a)) << 32) |
    static_cast<std::uint32_t>(b);
}

bool dominates(const Label& a, const Label& b) {
  return a.departure >= b.departure && a.arrival <= b.arrival &&
    a.transfers <= b.transfers && a.walks <= b.walks;
}

bool insert_label(std::vector<Label>& labels, const Label& candidate) {
  for (const auto& label : labels) if (dominates(label, candidate)) return false;
  labels.erase(std::remove_if(labels.begin(), labels.end(),
    [&](const Label& label) { return dominates(candidate, label); }), labels.end());
  labels.push_back(candidate);
  return true;
}

void record(Best& best, const Label& label) {
  const double duration = label.arrival - label.departure;
  if (!best.found || duration < best.duration ||
      (duration == best.duration && label.transfers < best.transfers)) {
    best = {true, duration, label.departure, label.arrival,
            label.transfers, label.walks};
  }
}
} // namespace

// [[Rcpp::export]]
SEXP raptor_proto_prepare(DataFrame rides, DataFrame walks, DataFrame rules) {
  XPtr<Network> network(new Network(), true);
  CharacterVector from = rides["from_stop_id"], to = rides["to_stop_id"];
  CharacterVector trip = rides["trip_id"];
  NumericVector dep = rides["departure_min"], arr = rides["arrival_min"];
  std::unordered_map<int, std::size_t> trip_positions;
  network->ride_count = rides.nrows();
  for (int i = 0; i < rides.nrows(); ++i) {
    const int trip_id = intern(as<std::string>(trip[i]), network->trip_ids);
    auto pos = trip_positions.find(trip_id);
    if (pos == trip_positions.end()) {
      trip_positions.emplace(trip_id, network->trips.size());
      network->trips.push_back(Trip{trip_id, {}});
      pos = trip_positions.find(trip_id);
    }
    network->trips[pos->second].rides.push_back({
      intern(as<std::string>(from[i]), network->stop_ids),
      intern(as<std::string>(to[i]), network->stop_ids), trip_id, dep[i], arr[i]});
  }
  for (auto& trip_data : network->trips) {
    std::stable_sort(trip_data.rides.begin(), trip_data.rides.end(),
      [](const Ride& a, const Ride& b) {
        return a.dep != b.dep ? a.dep < b.dep : a.arr < b.arr;
      });
  }

  CharacterVector walk_from = walks["from_stop_id"], walk_to = walks["to_stop_id"];
  NumericVector walk_min = walks["duration_min"];
  network->walk_count = walks.nrows();
  for (int i = 0; i < walks.nrows(); ++i) {
    const int source = intern(as<std::string>(walk_from[i]), network->stop_ids);
    const int target = intern(as<std::string>(walk_to[i]), network->stop_ids);
    network->incoming_walks[target].push_back({source, walk_min[i]});
  }

  CharacterVector rule_from = rules["from_stop_id"], rule_to = rules["to_stop_id"];
  CharacterVector rule_type = rules["transfer_type"];
  NumericVector seconds(rules.nrows(), 0.0);
  if (rules.containsElementNamed("min_transfer_time")) {
    CharacterVector values = rules["min_transfer_time"];
    for (int i = 0; i < rules.nrows(); ++i)
      if (values[i] != NA_STRING && LENGTH(values[i]) > 0)
        seconds[i] = std::stod(as<std::string>(values[i]));
  }
  for (int i = 0; i < rules.nrows(); ++i) {
    const int source = intern(as<std::string>(rule_from[i]), network->stop_ids);
    const int target = intern(as<std::string>(rule_to[i]), network->stop_ids);
    network->rules[pair_key(source, target)] = {
      std::stoi(as<std::string>(rule_type[i])), seconds[i] / 60.0};
  }
  return network;
}

// Each round boards one trip; all later stops on that trip are relaxed in the
// same round. Labels retain (initial departure, arrival) Pareto alternatives,
// since earliest arrival alone is not the fastest-elapsed objective here.
// [[Rcpp::export]]
List raptor_proto_route(SEXP handle, CharacterVector origins,
                        List destination_sets, double window_start,
                        double window_end, int max_rounds = 8) {
  XPtr<Network> network(handle);
  std::unordered_set<int> origin_ids;
  for (auto x : origins) if (x != NA_STRING) {
    auto found = network->stop_ids.find(as<std::string>(x));
    if (found != network->stop_ids.end()) origin_ids.insert(found->second);
  }
  CharacterVector names = destination_sets.names();
  std::unordered_map<int, std::vector<int>> targets;
  std::vector<Best> best(destination_sets.size());
  for (int k = 0; k < destination_sets.size(); ++k) {
    CharacterVector stops = destination_sets[k];
    for (auto x : stops) if (x != NA_STRING) {
      auto found = network->stop_ids.find(as<std::string>(x));
      if (found == network->stop_ids.end()) continue;
      targets[found->second].push_back(k);
      if (origin_ids.count(found->second)) best[k] = {true, 0.0, NA_REAL, NA_REAL, 0, 0};
    }
  }

  const std::size_t stop_count = network->stop_ids.size();
  std::vector<std::vector<Label>> previous(stop_count), current(stop_count);
  std::size_t labels_inserted = 0, board_tests = 0;
  int rounds_used = 0;
  for (int round = 1; round <= max_rounds; ++round) {
    std::size_t inserted_this_round = 0;
    for (const auto& trip : network->trips) {
      const auto& rides = trip.rides;
      for (std::size_t i = 0; i < rides.size(); ++i) {
        const Ride& first = rides[i];
        std::vector<std::pair<Label, int>> boarders;
        if (round == 1) {
          if (origin_ids.count(first.from) && first.dep >= window_start &&
              first.dep < window_end) {
            boarders.push_back({Label{first.dep, first.dep, 0, 0, trip.id}, first.from});
          }
        } else {
          auto collect = [&](int source, double walk_duration, bool walked) {
            auto& labels = previous[source];
            auto rule_it = network->rules.find(pair_key(source, first.from));
            Rule rule{0, 0.0};
            if (rule_it != network->rules.end()) rule = rule_it->second;
            if (rule.type == 3) return;
            const double minimum = rule.type == 2 ? rule.minimum : 0.0;
            const double ready = first.dep - std::max(walk_duration, minimum);
            for (const auto& label : labels) {
              ++board_tests;
              if (label.trip == trip.id || label.arrival > ready) continue;
              Label boarded = label;
              boarded.transfers += 1;
              boarded.walks += walked ? 1 : 0;
              boarded.trip = trip.id;
              boarders.push_back({boarded, source});
            }
          };
          collect(first.from, 0.0, false);
          auto wit = network->incoming_walks.find(first.from);
          if (wit != network->incoming_walks.end())
            for (const auto& walk : wit->second)
              collect(walk.from, walk.minutes, walk.minutes > 0.0);
        }
        if (boarders.empty()) continue;
        for (const auto& boarder : boarders) {
          Label label = boarder.first;
          for (std::size_t j = i; j < rides.size(); ++j) {
            const Ride& segment = rides[j];
            if (j > i && (segment.from != rides[j - 1].to ||
                          segment.dep < rides[j - 1].arr)) break;
            label.arrival = segment.arr;
            if (insert_label(current[segment.to], label)) {
              ++inserted_this_round;
              ++labels_inserted;
              auto target = targets.find(segment.to);
              if (target != targets.end())
                for (int k : target->second) record(best[k], label);
            }
          }
        }
      }
    }
    if (!inserted_this_round) break;
    rounds_used = round;
    previous.swap(current);
    for (auto& labels : current) labels.clear();
  }

  List journeys(best.size()); journeys.attr("names") = names;
  for (std::size_t k = 0; k < best.size(); ++k) {
    const Best& b = best[k];
    journeys[k] = List::create(
      _["travel_time_min"] = b.found ? b.duration : NA_REAL,
      _["departure_min"] = b.found ? b.departure : NA_REAL,
      _["arrival_min"] = b.found ? b.arrival : NA_REAL,
      _["transfers"] = b.found ? b.transfers : NA_INTEGER,
      _["walking_transfers"] = b.found ? b.walks : NA_INTEGER);
  }
  return List::create(_["journeys"] = journeys,
    _["metrics"] = List::create(
      _["rounds_used"] = rounds_used, _["labels_inserted"] = labels_inserted,
      _["boarding_tests"] = board_tests,
      _["trips"] = network->trips.size(), _["ride_edges"] = network->ride_count,
      _["transfer_edges"] = network->walk_count));
}
